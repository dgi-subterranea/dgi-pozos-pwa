// E8-3, recorrido completo SIN mockear el dominio: Api (doPost / handlers) -> permisos -> Operaciones -> FotosPozosModeracionService (dominio real) -> repositorios REALES (FotosPozos +
// FotosPozoEventos) sobre hojas en memoria -> estado derivado -> respuesta, con varios usuarios, varios pozos y fotos, y la galeria / imagen / resumen reales. Solo se simulan Apps Script
// (sesion, cache, lock, hojas) y el storage (lectura de imagen).
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const Api = require('../src/Api');
const Repo = require('../src/FotosPozosRepository');
const Eventos = require('../src/FotosPozoEventosRepository');
const M = require('../src/FotosPozosModeracionService');
const Ops = require('../src/FotosPozosModeracionOperaciones');
const Service = require('../src/FotosPozosService');

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const A1 = uuid(1); const A2 = uuid(2); const B1 = uuid(3); const NE1 = uuid(4);
const COLS = Eventos.FOTOS_POZO_EVENTOS_COLUMNAS;

const USUARIOS = {
  'ana@x.com': { nombre: 'Ana', permisos: { fotos: true, fotos_carga: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { fotos: true } },
  'mod@x.com': { nombre: 'Moderadora Uno', permisos: { fotos: true, fotos_moderar: true } },
  'mod2@x.com': { nombre: 'Moderador Dos', permisos: { fotos: true, fotos_moderar: true } },
  'ciego@x.com': { nombre: 'Ciego', permisos: { fotos_moderar: true, fotos_carga: true } },
  'sinfotos@x.com': { nombre: 'Sin', permisos: {} }
};

let hojas;
let n;
let cache;
const crid = () => 'req-' + String(++n).padStart(8, '0');

function filaFoto(id, wellId, extra) {
  const indices = Repo.fotosPozosRepository_indiceColumnas(Repo.FOTOS_POZOS_COLUMNAS);
  return Repo.fotosPozosRepository_filaDesdeFoto(Object.assign({
    fotoId: id, wellId: wellId, monitoringId: '', estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', fuente: 'CAMPO_APP', tipoFoto: 'OTRA', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES',
    emailUsuarioCarga: 'ana@x.com', timestampRegistro: '2026-10-07 12:55:23', driveFileId: 'DRIVE_FILE_' + id.slice(-4), driveThumbId: 'DRIVE_THUMB_' + id.slice(-4)
  }, extra || {}), indices, Repo.FOTOS_POZOS_COLUMNAS.length);
}

function montar(fotos, sinEventos) {
  const def = { FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS].concat(fotos) };
  if (!sinEventos) { def.FotosPozoEventos = [COLS]; }
  hojas = instalarSheetsFalsos(def);
}

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Object.assign(global, Repo, Eventos, M, Ops, Service);
  n = 0;
  cache = global.CacheService.getScriptCache();
  global.verifySessionToken.mockImplementation((token) => ({ valid: true, email: token }));
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => !!USUARIOS[email] && USUARIOS[email].permisos[modulo] === true);
  global.getUserAccess.mockImplementation((email) => ({ found: true, active: true, nombre: USUARIOS[email] ? USUARIOS[email].nombre : null, permisos: USUARIOS[email] ? USUARIOS[email].permisos : {} }));
  global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
  montar([filaFoto(A1, '14-0001'), filaFoto(A2, '14-0001'), filaFoto(B1, '14-0002'), filaFoto(NE1, '', { monitoringId: 'INA 536' })]);
});

const post = (token, body) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ sessionToken: token }, body)) } }).text);
const solicitar = (token, fotoId, extra) => post(token, Object.assign({ action: 'solicitarRetiroFotoPozo', fotoId: fotoId, motivoCodigo: 'DUPLICADA', clientRequestId: crid() }, extra || {}));
const retirar = (token, fotoId, extra) => post(token, Object.assign({ action: 'retirarFotoPozo', fotoId: fotoId, motivoCodigo: 'DUPLICADA', clientRequestId: crid() }, extra || {}));
const resolver = (token, solicitudId, resolucion, extra) => post(token, Object.assign({ action: 'resolverRetiroFotoPozo', solicitudId: solicitudId, resolucion: resolucion, clientRequestId: crid() }, extra || {}));
const reponer = (token, fotoId, extra) => post(token, Object.assign({ action: 'reponerFotoPozo', fotoId: fotoId, clientRequestId: crid() }, extra || {}));
const galeria = (token, wellId, monitoringId) => post(token, { action: 'getFotosPozo', wellId: wellId || '', monitoringId: monitoringId || '', orden: 'recientes' });
const imagen = (token, fotoId, variante) => post(token, { action: 'getFotoPozo', fotoId: fotoId, variante: variante || 'thumb' });
const resumen = (token) => post(token, { action: 'getResumenFotosPozos' });
const filasEventos = () => hojas.FotosPozoEventos.filas.slice(1);
const col = (c) => COLS.indexOf(c);
const idsGaleria = (r) => r.data.fotos.map((f) => f.fotoId).sort();

describe('recorrido completo: solicitar -> cola -> aprobar -> galeria -> reponer', () => {
  test('flujo feliz con varios usuarios, pozos y fotos', () => {
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A1, A2].sort());
    expect(resumen('lector@x.com').data).toEqual({ '14-0001': 2, '14-0002': 1, 'INA 536': 1 });

    const s = solicitar('ana@x.com', A1, { motivoCodigo: 'OTRO', motivoTexto: 'no es el pozo' });
    expect(s).toMatchObject({ status: 'ok', data: { fotoId: A1, duplicada: false } });
    const solicitudId = s.data.solicitudId;
    expect(solicitudId).toMatch(/^[0-9a-f-]{36}$/);
    // una solicitud abierta NO oculta la foto ni la saca del resumen
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A1, A2].sort());
    expect(resumen('lector@x.com').data['14-0001']).toBe(2);

    const cola = post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' });
    expect(cola.data.total).toBe(1);
    expect(cola.data.items[0]).toMatchObject({ solicitudId, fotoId: A1, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'OTRO', motivoTexto: 'no es el pozo', nombre: 'Ana' });

    const r = resolver('mod@x.com', solicitudId, 'APROBADO');
    expect(r).toMatchObject({ status: 'ok', data: { fotoId: A1, solicitudId, resolucion: 'APROBADO', duplicada: false } });
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A2]);
    expect(resumen('lector@x.com').data).toEqual({ '14-0001': 1, '14-0002': 1, 'INA 536': 1 });
    expect(post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' }).data.total).toBe(0);

    const h = post('mod@x.com', { action: 'getHistorialFotoPozo', fotoId: A1 });
    expect(h.data.estado).toMatchObject({ estado: 'RETIRADA', visible: false, puedeReponerse: true, origenRetiro: 'EVENTO' });
    expect(h.data.eventos.map((e) => e.evento)).toEqual(['RETIRO_RESUELTO', 'RETIRO_SOLICITADO']);

    expect(reponer('mod2@x.com', A1)).toMatchObject({ status: 'ok', data: { fotoId: A1 } });
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A1, A2].sort());
    expect(resumen('lector@x.com').data['14-0001']).toBe(2);
  });

  test('rechazo: la foto sigue visible y el cache de imagen / resumen NO se invalida', () => {
    const s = solicitar('ana@x.com', A1);
    imagen('lector@x.com', A1, 'thumb');
    resumen('lector@x.com');
    const antes = ['fotospozos_m_' + A1, 'fotospozos_t_' + A1, 'fotospozos_resumen'].map((k) => cache.get(k));
    antes.forEach((v) => expect(v).not.toBeNull());
    expect(resolver('mod@x.com', s.data.solicitudId, 'RECHAZADO')).toMatchObject({ status: 'ok', data: { resolucion: 'RECHAZADO' } });
    ['fotospozos_m_' + A1, 'fotospozos_t_' + A1, 'fotospozos_resumen'].forEach((k, i) => expect(cache.get(k)).toBe(antes[i]));
    expect(imagen('lector@x.com', A1).status).toBe('ok');
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toContain(A1);
  });

  test('retiro directo de un punto NE especial: sale de su galeria y del resumen', () => {
    expect(retirar('mod@x.com', NE1, { motivoCodigo: 'MALA_CALIDAD' }).status).toBe('ok');
    expect(galeria('lector@x.com', '', 'INA 536').data.fotos).toEqual([]);
    expect(resumen('lector@x.com').data['INA 536']).toBeUndefined();
  });

  test('la foto OCULTA legacy no se ve, no se cuenta, no se sirve y NO se repone; la moderadora si ve su imagen', () => {
    montar([filaFoto(A1, '14-0001', { estado: 'OCULTA' }), filaFoto(A2, '14-0001')]);
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A2]);
    expect(resumen('lector@x.com').data['14-0001']).toBe(1);
    expect(imagen('lector@x.com', A1)).toMatchObject({ status: 'error', code: 'FOTO_NOT_FOUND' });
    expect(reponer('mod@x.com', A1)).toMatchObject({ status: 'error', code: 'REPOSICION_NO_PERMITIDA' });
    expect(post('mod@x.com', { action: 'getFotoPozoModeracion', fotoId: A1, variante: 'thumb' }).status).toBe('ok');
    expect(filasEventos()).toHaveLength(0);
  });

  test('una foto recien subida (sin eventos, baseline ACTIVA + CONFIRMADO) se ve normalmente', () => {
    expect(filasEventos()).toHaveLength(0);
    expect(idsGaleria(galeria('lector@x.com', '14-0002'))).toEqual([B1]);
    expect(imagen('lector@x.com', B1).status).toBe('ok');
  });

  test('POR_REVISAR (sin vinculo confirmado) sigue sin verse', () => {
    montar([filaFoto(A1, '14-0001', { estadoVinculo: 'POR_REVISAR' }), filaFoto(A2, '14-0001')]);
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A2]);
    expect(resumen('lector@x.com').data['14-0001']).toBe(1);
  });
});

describe('caso critico de cache: miniatura cacheada, retiro, y un usuario normal pide la misma foto', () => {
  test.each([['retirar directo'], ['aprobar solicitud']])('%s: el usuario normal NO recibe el contenido cacheado', (via) => {
    expect(imagen('lector@x.com', A1, 'thumb').data.imagenBase64).toBe('AAAA');
    expect(cache.get('fotospozos_t_' + A1)).not.toBeNull();
    if (via === 'retirar directo') {
      retirar('mod@x.com', A1);
    } else {
      resolver('mod@x.com', solicitar('ana@x.com', A1).data.solicitudId, 'APROBADO');
    }
    expect(cache.get('fotospozos_t_' + A1)).toBeNull();
    expect(cache.get('fotospozos_m_' + A1)).toBeNull();
    expect(imagen('lector@x.com', A1, 'thumb')).toMatchObject({ status: 'error', code: 'FOTO_NOT_FOUND' });
    expect(imagen('lector@x.com', A1, 'full')).toMatchObject({ status: 'error', code: 'FOTO_NOT_FOUND' });
  });

  test('aunque el cache NO se hubiera invalidado, la visibilidad derivada se valida antes de servirlo', () => {
    imagen('lector@x.com', A1, 'thumb');
    hojas.FotosPozoEventos.filas.push(COLS.map((c) => ({ eventoId: uuid(700), secuencia: 1, evento: 'RETIRADA', fotoId: A1, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'PRIVACIDAD', email: 'x@x.com', nombre: 'X', timestampUtc: '2026-10-27T10:00:00.000Z', clientRequestId: 'seed-00000001' }[c] || '')));
    expect(cache.get('fotospozos_t_' + A1)).not.toBeNull();
    expect(imagen('lector@x.com', A1, 'thumb')).toMatchObject({ status: 'error', code: 'FOTO_NOT_FOUND' });
  });

  test('la respuesta de foto retirada es igual a la de una foto inexistente (no-oraculo)', () => {
    retirar('mod@x.com', A1);
    const retirada = imagen('lector@x.com', A1);
    const inexistente = imagen('lector@x.com', uuid(999));
    expect(retirada).toEqual(inexistente);
  });

  test('el moderador SI ve la imagen de una foto retirada con getFotoPozoModeracion (sin ids de Drive ni email)', () => {
    retirar('mod@x.com', A1, { motivoCodigo: 'PRIVACIDAD' });
    const r = post('mod@x.com', { action: 'getFotoPozoModeracion', fotoId: A1, variante: 'full' });
    expect(r).toEqual({ status: 'ok', data: { fotoId: A1, variante: 'full', mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
    expect(JSON.stringify(r)).not.toMatch(/DRIVE_|@/);
    expect(post('lector@x.com', { action: 'getFotoPozoModeracion', fotoId: A1, variante: 'full' }).code).toBe('PERMISSION_DENIED');
  });

  test('storage caido: el retiro logico igual se registra; solo la lectura de imagen del moderador devuelve STORAGE_UNAVAILABLE', () => {
    global.fotosStorageClient_obtenerPozo.mockImplementation(() => { throw new Error('storage caido'); });
    expect(retirar('mod@x.com', A1, { motivoCodigo: 'PRIVACIDAD' }).status).toBe('ok');
    expect(solicitar('ana@x.com', A2).status).toBe('ok');
    expect(post('mod@x.com', { action: 'getFotoPozoModeracion', fotoId: A1, variante: 'thumb' })).toMatchObject({ status: 'error', code: 'STORAGE_UNAVAILABLE' });
  });
});

describe('FAIL-CLOSED: sin hoja FotosPozoEventos (o esquema roto) nada se muestra ni se escribe', () => {
  const sinHoja = () => montar([filaFoto(A1, '14-0001')], true);

  test('galeria, imagen y resumen -> SERVICE_UNAVAILABLE (nunca fotos "sin moderar")', () => {
    sinHoja();
    expect(galeria('lector@x.com', '14-0001')).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(imagen('lector@x.com', A1)).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(resumen('lector@x.com')).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
  });

  test('las 4 escrituras y las 3 lecturas de moderador -> SERVICE_UNAVAILABLE; la hoja NO se auto-crea', () => {
    sinHoja();
    expect(solicitar('ana@x.com', A1).code).toBe('SERVICE_UNAVAILABLE');
    expect(retirar('mod@x.com', A1).code).toBe('SERVICE_UNAVAILABLE');
    expect(resolver('mod@x.com', uuid(50), 'APROBADO').code).toBe('SERVICE_UNAVAILABLE');
    expect(reponer('mod@x.com', A1).code).toBe('SERVICE_UNAVAILABLE');
    expect(post('mod@x.com', { action: 'getHistorialFotoPozo', fotoId: A1 }).code).toBe('SERVICE_UNAVAILABLE');
    expect(post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' }).code).toBe('SERVICE_UNAVAILABLE');
    expect(Object.keys(hojas)).toEqual(['FotosPozos']);
  });

  test('la imagen del moderador no deriva estado (solo lee FotosPozos y storage): sigue disponible aunque la hoja falte, y esta gateada', () => {
    sinHoja();
    expect(post('mod@x.com', { action: 'getFotoPozoModeracion', fotoId: A1, variante: 'thumb' }).status).toBe('ok');
    expect(post('lector@x.com', { action: 'getFotoPozoModeracion', fotoId: A1, variante: 'thumb' }).code).toBe('PERMISSION_DENIED');
  });

  test('esquema roto (falta una columna): lo mismo', () => {
    hojas.FotosPozoEventos.filas[0] = COLS.slice(0, 6);
    expect(galeria('lector@x.com', '14-0001').code).toBe('SERVICE_UNAVAILABLE');
    expect(retirar('mod@x.com', A1).code).toBe('SERVICE_UNAVAILABLE');
  });

  test('el mensaje de error orienta al operador (setup) pero no filtra ids de Drive, URLs ni emails', () => {
    sinHoja();
    const r = galeria('lector@x.com', '14-0001');
    expect(r.message).toMatch(/setupFotosPozoEventosSheet/);
    expect(JSON.stringify(r)).not.toMatch(/SPREADSHEET_DE_PRUEBA|DRIVE_|https?:|@/);
  });

  test('con historial NO derivable de una foto: esa foto no se muestra (las demas si)', () => {
    hojas.FotosPozoEventos.filas.push(COLS.map((c) => ({ eventoId: uuid(801), secuencia: 5, evento: 'RETIRADA', fotoId: A1, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', email: 'x@x.com', clientRequestId: 'seed-00000001' }[c] || '')));
    hojas.FotosPozoEventos.filas.push(COLS.map((c) => ({ eventoId: uuid(802), secuencia: 5, evento: 'REPUESTA', fotoId: A1, entidadTipo: 'WELL', entidadId: '14-0001', email: 'x@x.com', clientRequestId: 'seed-00000002' }[c] || '')));
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A2]);
    expect(imagen('lector@x.com', A1)).toMatchObject({ status: 'error', code: 'FOTO_NOT_FOUND' });
    expect(resumen('lector@x.com').data['14-0001']).toBe(1);
  });
});

describe('permisos de punta a punta', () => {
  test('moderacion: fotos_moderar sin fotos DENEGADO; fotos + fotos_moderar permitido', () => {
    expect(retirar('ciego@x.com', A1)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(post('ciego@x.com', { action: 'getHistorialFotoPozo', fotoId: A1 }).code).toBe('PERMISSION_DENIED');
    expect(retirar('mod@x.com', A1).status).toBe('ok');
    expect(filasEventos()).toHaveLength(1);
  });

  test('solicitar retiro: fotos_carga sin fotos DENEGADO; fotos + fotos_carga permitido; solo fotos DENEGADO; un moderador sin fotos_carga no solicita', () => {
    expect(solicitar('ciego@x.com', A1).code).toBe('PERMISSION_DENIED');
    expect(solicitar('lector@x.com', A1).code).toBe('PERMISSION_DENIED');
    expect(solicitar('mod@x.com', A1).code).toBe('PERMISSION_DENIED');
    expect(solicitar('sinfotos@x.com', A1).code).toBe('PERMISSION_DENIED');
    expect(solicitar('ana@x.com', A1).status).toBe('ok');
    expect(filasEventos()).toHaveLength(1);
  });

  test('un autor (ana) no retira directo ni resuelve ni repone; ser autor de la foto no da permisos', () => {
    const s = solicitar('ana@x.com', A1);
    expect(retirar('ana@x.com', A1).code).toBe('PERMISSION_DENIED');
    expect(resolver('ana@x.com', s.data.solicitudId, 'APROBADO').code).toBe('PERMISSION_DENIED');
    expect(reponer('ana@x.com', A1).code).toBe('PERMISSION_DENIED');
    expect(post('ana@x.com', { action: 'getFotosPozosPendientesModeracion' }).code).toBe('PERMISSION_DENIED');
  });

  test('un no-moderador recibe EXACTAMENTE lo mismo para una foto existente, retirada o inexistente al solicitar (sin oraculo)', () => {
    retirar('mod@x.com', A2);
    const ok = solicitar('ana@x.com', A1).status;
    expect(ok).toBe('ok');
    const retirada = solicitar('ana@x.com', A2, { clientRequestId: 'otro-00000001' });
    const inexistente = solicitar('ana@x.com', uuid(998), { clientRequestId: 'otro-00000002' });
    const oculta = (() => { montar([filaFoto(A1, '14-0001', { estado: 'OCULTA' })]); return solicitar('ana@x.com', A1, { clientRequestId: 'otro-00000003' }); })();
    [retirada, inexistente, oculta].forEach((r) => expect(r).toEqual(inexistente));
    expect(inexistente.code).toBe('FOTO_NOT_FOUND');
  });
});

describe('el cliente no puede ser autoridad de identidad, entidad, estado ni orden', () => {
  test('doPost: email, nombre, wellId, monitoringId, estado, secuencia, timestampUtc, entidad y solicitudId del cliente se ignoran', () => {
    const intruso = { email: 'falso@x.com', nombre: 'Falso', wellId: '99-9999', monitoringId: 'INA 999', estado: 'RETIRADA', secuencia: 1, timestampUtc: '2000-01-01T00:00:00.000Z', entidadTipo: 'WELL', entidadId: '99-9999', eventoId: uuid(77), solicitudId: uuid(78), resolucion: 'APROBADO' };
    const s = solicitar('ana@x.com', A1, intruso);
    expect(s.status).toBe('ok');
    const f = filasEventos()[0];
    expect(f[col('email')]).toBe('ana@x.com');
    expect(f[col('nombre')]).toBe('Ana');
    expect(f[col('entidadId')]).toBe('14-0001');
    expect(f[col('secuencia')]).toBe(1);
    expect(f[col('eventoId')]).not.toBe(uuid(77));
    expect(String(f[col('timestampUtc')])).not.toMatch(/^2000/);
    expect(s.data.solicitudId).toBe(f[col('eventoId')]);

    const r = retirar('mod@x.com', A2, intruso);
    expect(r.status).toBe('ok');
    expect(filasEventos()[1][col('email')]).toBe('mod@x.com');
    expect(filasEventos()[1][col('entidadId')]).toBe('14-0001');
  });

  test('resolver: la foto sale de la SOLICITUD; un fotoId del cliente no la cambia', () => {
    const s = solicitar('ana@x.com', A1);
    const r = resolver('mod@x.com', s.data.solicitudId, 'APROBADO', { fotoId: B1, wellId: '14-0002' });
    expect(r.data.fotoId).toBe(A1);
    expect(filasEventos()[1][col('fotoId')]).toBe(A1);
    expect(filasEventos()[1][col('entidadId')]).toBe('14-0001');
    expect(idsGaleria(galeria('lector@x.com', '14-0002'))).toEqual([B1]);
  });

  test('ninguna respuesta de escritura contiene email, secuencia, clientRequestId ni claves de cache', () => {
    const s = solicitar('ana@x.com', A1, { motivoCodigo: 'OTRO', motivoTexto: 'texto privado' });
    const r = resolver('mod@x.com', s.data.solicitudId, 'APROBADO');
    const rp = reponer('mod2@x.com', A1);
    [s, r, rp].forEach((x) => expect(JSON.stringify(x)).not.toMatch(/@|secuencia|clientRequestId|fotospozos_|req-0|texto privado/));
  });
});

describe('idempotencia punta a punta', () => {
  test('retry exacto: misma respuesta (duplicada), 1 evento, sin secuencia nueva, sin otra fila de Historial, sin invalidar cache', () => {
    const body = { action: 'retirarFotoPozo', fotoId: A1, motivoCodigo: 'DUPLICADA', clientRequestId: 'retry-0000001' };
    const a = post('mod@x.com', body);
    expect(a.data.duplicada).toBe(false);
    const historialAntes = global.logHistoryEvent.mock.calls.length;
    cache.put('fotospozos_resumen', '{"x":1}', 100);
    const b = post('mod@x.com', body);
    expect(b).toEqual({ status: 'ok', data: { fotoId: A1, duplicada: true } });
    expect(filasEventos()).toHaveLength(1);
    expect(global.logHistoryEvent.mock.calls.length).toBe(historialAntes);
    expect(cache.get('fotospozos_resumen')).toBe('{"x":1}');
    // y la siguiente escritura usa la secuencia 2 (no se consumio ninguna)
    retirar('mod@x.com', A2);
    expect(filasEventos().map((f) => f[col('secuencia')])).toEqual([1, 2]);
  });

  test('mismo clientRequestId + contenido distinto -> IDEMPOTENCY_CONFLICT', () => {
    post('mod@x.com', { action: 'retirarFotoPozo', fotoId: A1, motivoCodigo: 'DUPLICADA', clientRequestId: 'conflicto-001' });
    expect(post('mod@x.com', { action: 'retirarFotoPozo', fotoId: A1, motivoCodigo: 'MALA_CALIDAD', clientRequestId: 'conflicto-001' }).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(post('mod@x.com', { action: 'retirarFotoPozo', fotoId: A2, motivoCodigo: 'DUPLICADA', clientRequestId: 'conflicto-001' }).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(filasEventos()).toHaveLength(1);
  });

  test('usuarios distintos con el mismo clientRequestId: operaciones independientes', () => {
    expect(post('mod@x.com', { action: 'retirarFotoPozo', fotoId: A1, motivoCodigo: 'DUPLICADA', clientRequestId: 'compartido-01' }).data.duplicada).toBe(false);
    expect(post('mod2@x.com', { action: 'retirarFotoPozo', fotoId: A2, motivoCodigo: 'DUPLICADA', clientRequestId: 'compartido-01' }).data.duplicada).toBe(false);
    expect(post('ana@x.com', { action: 'solicitarRetiroFotoPozo', fotoId: B1, motivoCodigo: 'DUPLICADA', clientRequestId: 'compartido-01' }).data.duplicada).toBe(false);
    expect(filasEventos()).toHaveLength(3);
  });

  test.each([['corto'], ['con espacios aqui'], ['ñandu-12345'], ['a'.repeat(65)], ['x!x!x!x!x!'], ['']])('clientRequestId invalido %j -> INVALID_CLIENT_REQUEST_ID sin escribir', (id) => {
    expect(post('mod@x.com', { action: 'retirarFotoPozo', fotoId: A1, motivoCodigo: 'DUPLICADA', clientRequestId: id }).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(filasEventos()).toHaveLength(0);
  });

  test.each([['abcdefgh'], ['A_b-C_d-1234'], ['a'.repeat(64)]])('clientRequestId valido %j', (id) => {
    expect(post('mod@x.com', { action: 'retirarFotoPozo', fotoId: A1, motivoCodigo: 'DUPLICADA', clientRequestId: id }).status).toBe('ok');
  });
});

describe('Historial transversal', () => {
  test('una fila resumida por cada escritura exitosa (accion, entidad, OK); sin motivo, fotoId, email redundante ni base64', () => {
    const s = solicitar('ana@x.com', A1, { motivoCodigo: 'OTRO', motivoTexto: 'TEXTO PRIVADO COMPLETO' });
    resolver('mod@x.com', s.data.solicitudId, 'APROBADO');
    reponer('mod@x.com', A1);
    retirar('mod@x.com', NE1);
    expect(global.logHistoryEvent.mock.calls).toEqual([
      ['ana@x.com', 'solicitarRetiroFotoPozo', '14-0001', 'OK'],
      ['mod@x.com', 'resolverRetiroFotoPozo', '14-0001', 'OK'],
      ['mod@x.com', 'reponerFotoPozo', '14-0001', 'OK'],
      ['mod@x.com', 'retirarFotoPozo', 'INA 536', 'OK']
    ]);
    expect(JSON.stringify(global.logHistoryEvent.mock.calls)).not.toMatch(/TEXTO PRIVADO|AAAA|req-0|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  test('errores de negocio se auditan con su codigo; las lecturas OK no escriben Historial', () => {
    retirar('mod@x.com', uuid(555));
    expect(global.logHistoryEvent).toHaveBeenLastCalledWith('mod@x.com', 'retirarFotoPozo', null, 'FOTO_NOT_FOUND');
    global.logHistoryEvent.mockClear();
    post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' });
    post('mod@x.com', { action: 'getHistorialFotoPozo', fotoId: A1 });
    galeria('lector@x.com', '14-0001');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('sin Telegram ni UrlFetch en moderacion', () => {
    retirar('mod@x.com', A1);
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
});

describe('PRIVACIDAD: retiro logico, el archivo permanece', () => {
  test('retirar por PRIVACIDAD: oculta, invalida cache, marca requiereRevisionBorrado y NO toca Drive ni storage', () => {
    global.DriveApp = { getFileById: jest.fn(), getFolderById: jest.fn() };
    global.fotosStorageClient_obtenerPozo.mockClear();
    imagen('lector@x.com', A1);
    global.fotosStorageClient_obtenerPozo.mockClear();
    const r = retirar('mod@x.com', A1, { motivoCodigo: 'PRIVACIDAD' });
    expect(r.status).toBe('ok');
    expect(global.DriveApp.getFileById).not.toHaveBeenCalled();
    expect(global.DriveApp.getFolderById).not.toHaveBeenCalled();
    expect(global.fotosStorageClient_obtenerPozo).not.toHaveBeenCalled();
    expect(typeof global.fotosStorageClient_trashFotoPozo).toBe('undefined');
    expect(cache.get('fotospozos_t_' + A1)).toBeNull();
    expect(imagen('lector@x.com', A1).code).toBe('FOTO_NOT_FOUND');
    const h = post('mod@x.com', { action: 'getHistorialFotoPozo', fotoId: A1 });
    expect(h.data.estado).toMatchObject({ estado: 'RETIRADA', requiereRevisionBorrado: true });
    // la fila de FotosPozos y sus referencias a Drive siguen intactas
    const fila = hojas.FotosPozos.filas[1];
    expect(fila[Repo.FOTOS_POZOS_COLUMNAS.indexOf('driveFileId')]).toBe('DRIVE_FILE_' + A1.slice(-4));
    expect(fila[Repo.FOTOS_POZOS_COLUMNAS.indexOf('estado')]).toBe('ACTIVA');
  });

  test('el historial de moderacion no expone ids de Drive ni emails', () => {
    solicitar('ana@x.com', A1);
    const h = post('mod@x.com', { action: 'getHistorialFotoPozo', fotoId: A1 });
    expect(JSON.stringify(h)).not.toMatch(/DRIVE_|@|req-0|secuencia/);
  });
});

describe('carrera simulada: dos moderadores', () => {
  test('el segundo en llegar al lock encuentra el estado ya cambiado (revalidacion dentro del lock)', () => {
    const s = solicitar('ana@x.com', A1);
    let primera = true;
    global.LockService = {
      getScriptLock: () => ({
        waitLock: () => {
          if (primera) {
            primera = false;
            // "el otro moderador" gana el lock primero y resuelve la solicitud
            hojas.FotosPozoEventos.filas.push(COLS.map((c) => ({ eventoId: uuid(900), secuencia: 2, evento: 'RETIRO_RESUELTO', fotoId: A1, entidadTipo: 'WELL', entidadId: '14-0001', solicitudId: s.data.solicitudId, resolucion: 'RECHAZADO', email: 'mod2@x.com', nombre: 'Moderador Dos', timestampUtc: '2026-10-27T12:00:00.000Z', clientRequestId: 'otro-modera01' }[c] || '')));
          }
        },
        releaseLock: () => {}
      })
    };
    const r = resolver('mod@x.com', s.data.solicitudId, 'APROBADO');
    expect(r).toMatchObject({ status: 'error', code: 'SOLICITUD_YA_RESUELTA' });
    expect(filasEventos()).toHaveLength(2);
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toContain(A1);
  });
});

describe('cola de pendientes: volumen y forma', () => {
  test('varias solicitudes de varios pozos: mas reciente primero, payload minimo, UNA lectura de cada hoja', () => {
    const s1 = solicitar('ana@x.com', A1).data.solicitudId;
    const s2 = solicitar('ana@x.com', B1, { motivoCodigo: 'OTRO', motivoTexto: 'otra cosa' }).data.solicitudId;
    const s3 = solicitar('ana@x.com', NE1).data.solicitudId;
    const leerEventos = jest.fn(Eventos.fotosPozoEventosRepository_leerTodos);
    const leerFotos = jest.fn(Repo.fotosPozosRepository_leerTodasLasFotos);
    global.fotosPozoEventosRepository_leerTodos = leerEventos;
    global.fotosPozosRepository_leerTodasLasFotos = leerFotos;
    const r = post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' });
    expect(leerEventos).toHaveBeenCalledTimes(1);
    expect(leerFotos).toHaveBeenCalledTimes(1);
    expect(r.data.items.map((i) => i.solicitudId)).toEqual([s3, s2, s1]);
    r.data.items.forEach((i) => expect(Object.keys(i).sort()).toEqual(['entidadId', 'entidadTipo', 'foto', 'fotoId', 'motivoCodigo', 'motivoTexto', 'nombre', 'solicitudId', 'timestampUtc']));
    expect(JSON.stringify(r)).not.toMatch(/@|DRIVE_|secuencia|clientRequestId|base64/i);
  });

  test('paginacion por cursor via doPost', () => {
    const ids = [A1, A2, B1, NE1].map((f) => solicitar('ana@x.com', f).data.solicitudId).reverse();
    const p1 = post('mod@x.com', { action: 'getFotosPozosPendientesModeracion', limit: 3 });
    expect(p1.data).toMatchObject({ total: 4, hayMas: true });
    expect(p1.data.items.map((i) => i.solicitudId)).toEqual(ids.slice(0, 3));
    const p2 = post('mod@x.com', { action: 'getFotosPozosPendientesModeracion', limit: 3, cursor: p1.data.cursor });
    expect(p2.data.items.map((i) => i.solicitudId)).toEqual(ids.slice(3));
    expect(p2.data.hayMas).toBe(false);
    expect(post('mod@x.com', { action: 'getFotosPozosPendientesModeracion', limit: 1000 }).code).toBe('INVALID_LIMIT');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// E8-5: tieneSolicitudRetiro en la galeria y listado de retiradas, por doPost y con el dominio real
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const retiradasPost = (token, extra) => post(token, Object.assign({ action: 'getFotosPozosRetiradasModeracion' }, extra || {}));
const flagGaleria = (token, wellId, fotoId) => galeria(token, wellId).data.fotos.find((f) => f.fotoId === fotoId);

describe('E8-5: la solicitud abierta sobrevive a una nueva sesion (viene del backend)', () => {
  test('solicitar -> true para todos los que ven la galeria; rechazar -> false; la foto nunca se oculta ni cambia el contador', () => {
    expect(flagGaleria('ana@x.com', '14-0001', A1).tieneSolicitudRetiro).toBe(false);
    const s = solicitar('ana@x.com', A1);
    ['ana@x.com', 'lector@x.com', 'mod@x.com'].forEach((u) => { expect(flagGaleria(u, '14-0001', A1).tieneSolicitudRetiro).toBe(true); });
    expect(flagGaleria('mod@x.com', '14-0001', A2).tieneSolicitudRetiro).toBe(false);
    expect(resumen('lector@x.com').data['14-0001']).toBe(2);
    expect(galeria('lector@x.com', '14-0001').data.total).toBe(2);
    expect(resolver('mod@x.com', s.data.solicitudId, 'RECHAZADO').status).toBe('ok');
    expect(flagGaleria('ana@x.com', '14-0001', A1).tieneSolicitudRetiro).toBe(false);
    expect(resumen('lector@x.com').data['14-0001']).toBe(2);
    // y se puede volver a sugerir
    expect(solicitar('ana@x.com', A1).status).toBe('ok');
    expect(flagGaleria('ana@x.com', '14-0001', A1).tieneSolicitudRetiro).toBe(true);
  });

  test('aprobar: la foto sale de la galeria normal y del contador; el booleano nunca lleva datos de la solicitud', () => {
    const s = solicitar('ana@x.com', A1, { motivoCodigo: 'OTRO', motivoTexto: 'texto privado de Ana' });
    const antes = JSON.stringify(galeria('lector@x.com', '14-0001'));
    expect(antes).not.toMatch(/texto privado|ana@x\.com|OTRO|solicitud|motivo|"Ana"/);
    resolver('mod@x.com', s.data.solicitudId, 'APROBADO');
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A2]);
    expect(resumen('lector@x.com').data['14-0001']).toBe(1);
  });

  test('la galeria sin la hoja de eventos es SERVICE_UNAVAILABLE (nunca una galeria sin moderar)', () => {
    montar([filaFoto(A1, '14-0001')], true);
    expect(galeria('lector@x.com', '14-0001').code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('E8-5: listado de fotos retiradas', () => {
  test('permisos: solo fotos + fotos_moderar; lector, fotos_carga, fotos_moderar sin fotos y sin permisos reciben PERMISSION_DENIED', () => {
    ['lector@x.com', 'ana@x.com', 'ciego@x.com', 'sinfotos@x.com'].forEach((u) => { expect(retiradasPost(u).code).toBe('PERMISSION_DENIED'); });
    expect(retiradasPost('mod@x.com').status).toBe('ok');
    expect(retiradasPost('mod2@x.com').status).toBe('ok');
  });

  test('retirar -> aparece; reponer -> desaparece y vuelve a la galeria; una retirada no se cuela en la galeria normal', () => {
    retirar('mod@x.com', A1, { motivoCodigo: 'PRIVACIDAD' });
    const r = retiradasPost('mod@x.com');
    expect(r.data).toMatchObject({ total: 1, hayMas: false, cursor: null });
    expect(r.data.items[0]).toMatchObject({ fotoId: A1, entidadTipo: 'WELL', entidadId: '14-0001', origenRetiro: 'EVENTO', motivoCodigo: 'PRIVACIDAD', nombre: 'Moderadora Uno', requiereRevisionBorrado: true, viaSolicitud: false });
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A2]);
    expect(reponer('mod2@x.com', A1).status).toBe('ok');
    expect(retiradasPost('mod@x.com').data.total).toBe(0);
    expect(idsGaleria(galeria('lector@x.com', '14-0001'))).toEqual([A1, A2].sort());
  });

  test('aprobar una solicitud la pasa de la cola de pendientes a retiradas (con el motivo de la solicitud y el nombre de quien aprobo)', () => {
    const s = solicitar('ana@x.com', B1, { motivoCodigo: 'OTRO', motivoTexto: 'otra cosa' });
    expect(post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' }).data.total).toBe(1);
    expect(retiradasPost('mod@x.com').data.total).toBe(0);
    resolver('mod2@x.com', s.data.solicitudId, 'APROBADO');
    expect(post('mod@x.com', { action: 'getFotosPozosPendientesModeracion' }).data.total).toBe(0);
    const r = retiradasPost('mod@x.com');
    expect(r.data.items[0]).toMatchObject({ fotoId: B1, entidadId: '14-0002', motivoCodigo: 'OTRO', motivoTexto: 'otra cosa', nombre: 'Moderador Dos', viaSolicitud: true });
  });

  test('una OCULTA legacy no aparece como reponible, y reponerla desde el backend sigue prohibido', () => {
    montar([filaFoto(A1, '14-0001', { estado: 'OCULTA' }), filaFoto(A2, '14-0001')]);
    expect(retiradasPost('mod@x.com').data.total).toBe(0);
    expect(reponer('mod@x.com', A1)).toMatchObject({ status: 'error' });
  });

  test('paginacion por cursor via doPost, mas reciente primero, y limites', () => {
    const fotos = [A1, A2, B1, NE1];
    fotos.forEach((f) => retirar('mod@x.com', f));
    const orden = fotos.slice().reverse();
    const p1 = retiradasPost('mod@x.com', { limit: 3 });
    expect(p1.data).toMatchObject({ total: 4, hayMas: true });
    expect(p1.data.items.map((i) => i.fotoId)).toEqual(orden.slice(0, 3));
    const p2 = retiradasPost('mod@x.com', { limit: 3, cursor: p1.data.cursor });
    expect(p2.data.items.map((i) => i.fotoId)).toEqual(orden.slice(3));
    expect(p2.data.hayMas).toBe(false);
    expect(retiradasPost('mod@x.com', { limit: 1000 }).code).toBe('INVALID_LIMIT');
    expect(retiradasPost('mod@x.com', { cursor: -1 }).code).toBe('INVALID_CURSOR');
  });

  test('payload minimo: sin email, clientRequestId, secuencia, ids de Drive, base64 ni URLs; UNA lectura de cada hoja', () => {
    retirar('mod@x.com', A1, { motivoCodigo: 'OTRO', motivoTexto: 'detalle' });
    retirar('mod@x.com', NE1);
    const leerEventos = jest.fn(Eventos.fotosPozoEventosRepository_leerTodos);
    const leerFotos = jest.fn(Repo.fotosPozosRepository_leerTodasLasFotos);
    global.fotosPozoEventosRepository_leerTodos = leerEventos;
    global.fotosPozosRepository_leerTodasLasFotos = leerFotos;
    const r = retiradasPost('mod@x.com');
    expect(leerEventos).toHaveBeenCalledTimes(1);
    expect(leerFotos).toHaveBeenCalledTimes(1);
    expect(r.data.items).toHaveLength(2);
    expect(JSON.stringify(r)).not.toMatch(/@|DRIVE_|secuencia|clientRequestId|base64|https?:/i);
  });

  test('sin la hoja de eventos el listado es SERVICE_UNAVAILABLE sin detalle tecnico', () => {
    montar([filaFoto(A1, '14-0001')], true);
    const r = retiradasPost('mod@x.com');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(r)).not.toMatch(/FotosPozoEventos/);
  });

  test('el listado es una lectura: no escribe eventos', () => {
    retirar('mod@x.com', A1);
    const antes = filasEventos().length;
    retiradasPost('mod@x.com');
    expect(filasEventos()).toHaveLength(antes);
  });
});
