// Contratos de E8-2/E8-3: la moderacion depende SOLO de lo que FotosPozos ya tiene hoy (columnas, estados ACTIVA / OCULTA, vinculo, entidad, claves de cache) y NO toca nada existente: ni Api.js, ni
// permisos de Usuarios, ni el frontend, ni FotosPozosCambios (legacy), ni el storage. Si alguien cambia el esquema o las claves de cache de FotosPozos, estos tests lo detectan.
const fs = require('fs');
const path = require('path');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const raiz = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const Reemplazo = require('../src/FotosReemplazoService');
const Repo = require('../src/FotosPozosRepository');
const Service = require('../src/FotosPozosService');
const Eventos = require('../src/FotosPozoEventosRepository');
const M = require('../src/FotosPozosModeracionService');
const Ops = require('../src/FotosPozosModeracionOperaciones');

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const FOTO = uuid(1);

describe('contrato con el esquema actual de FotosPozos', () => {
  test('FotosPozos tiene las columnas de las que depende la moderacion', () => {
    ['fotoId', 'wellId', 'monitoringId', 'estado', 'estadoVinculo', 'emailUsuarioCarga', 'timestampRegistro'].forEach((c) => {
      expect(Repo.FOTOS_POZOS_COLUMNAS).toContain(c);
    });
  });

  test('una fila REAL de FotosPozos (leida por el repositorio) alimenta la moderacion sin adaptadores y coincide con esVisible', () => {
    const indices = Repo.fotosPozosRepository_indiceColumnas(Repo.FOTOS_POZOS_COLUMNAS);
    const estados = ['ACTIVA', 'OCULTA', '', 'activa'];
    const vinculos = ['CONFIRMADO', 'POR_REVISAR', ''];
    estados.forEach((estado) => vinculos.forEach((estadoVinculo) => {
      const fila = Repo.fotosPozosRepository_filaDesdeFoto({ fotoId: FOTO, wellId: '14-0001', monitoringId: '', estado: estado, estadoVinculo: estadoVinculo, emailUsuarioCarga: 'a@x.com', timestampRegistro: '2026-10-07 12:55:23' }, indices, Repo.FOTOS_POZOS_COLUMNAS.length);
      const foto = Repo.fotosPozosRepository_fotoDesdeFila(fila, indices);
      expect(M.fotosPozosModeracion_visible(foto, M.fotosPozosModeracion_derivar([]))).toBe(Repo.fotosPozosRepository_esVisible(foto));
      expect(M.fotosPozosModeracion_estadoFoto(foto, M.fotosPozosModeracion_derivar([])).fotoId).toBe(FOTO);
    }));
  });

  test('los valores de estado que escribe la galeria son los del baseline: ACTIVA (subida y importacion) y CONFIRMADO; OCULTA es el que esVisible descarta', () => {
    expect(M.FOTOS_MOD_ESTADOS_BASE).toEqual({ ACTIVA: 'ACTIVA', OCULTA: 'OCULTA' });
    const servicio = sinComentarios(leer('backend', 'src', 'FotosPozosService.js'));
    expect(servicio).toContain("estado: 'ACTIVA'");
    expect(servicio).toContain("estadoVinculo: 'CONFIRMADO'");
    const repo = sinComentarios(leer('backend', 'src', 'FotosPozosRepository.js'));
    expect(repo).toContain("foto.estado === 'ACTIVA' && foto.estadoVinculo === 'CONFIRMADO'");
    const importacion = sinComentarios(leer('backend', 'src', 'FotosPozosImport.js'));
    expect(importacion).toContain("'ACTIVA'");
    expect(importacion).toContain("'CONFIRMADO'");
  });

  test('la identidad canonica es la que usa el contador de Fotos: wellId si lo tiene, si no monitoringId', () => {
    const casos = [{ wellId: '14-0001', monitoringId: '' }, { wellId: '', monitoringId: 'INA 536' }, { wellId: '14-0001', monitoringId: 'INA 536' }];
    casos.forEach((f) => {
      expect(M.fotosPozosModeracion_entidadDeBase(f).id).toBe(f.wellId || f.monitoringId);
      expect(M.fotosPozosModeracion_entidadDeBase(f).tipo).toBe(f.wellId ? 'WELL' : 'MONITORING');
    });
    expect(Repo.fotosPozosRepository_perteneceAEntidad({ wellId: '14-0001', monitoringId: '' }, { wellId: '14-0001' })).toBe(true);
  });

  test('las entidades que acepta la subida son las que acepta la moderacion (wellId y monitoringId de formato valido)', () => {
    ['14-0001', '01-0012', '19-9999'].forEach((w) => {
      const e = Service.fotosPozosService_normalizarEntidad(w, '');
      expect(M.fotosPozosModeracion_entidadDeBase({ wellId: e.wellId, monitoringId: e.monitoringId })).toEqual({ tipo: 'WELL', id: w });
    });
    ['INA 536', 'MON_21', 'P-12/B'].forEach((m) => {
      const e = Service.fotosPozosService_normalizarEntidad('', m);
      expect(M.fotosPozosModeracion_entidadDeBase({ wellId: e.wellId, monitoringId: e.monitoringId })).toEqual({ tipo: 'MONITORING', id: m });
    });
  });

  test('los fotoId de la app (UUID v4) y de la importacion (UUID v5) son ids validos para la moderacion', () => {
    expect(M.fotosPozosModeracion_estadoFoto({ fotoId: require('crypto').randomUUID(), estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', wellId: '14-0001' }, M.fotosPozosModeracion_derivar([])).visible).toBe(true);
    expect(M.fotosPozosModeracion_estadoFoto({ fotoId: '57a70c0b-4082-5407-9238-57ecc0a23982', estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', wellId: '14-0001' }, M.fotosPozosModeracion_derivar([])).visible).toBe(true);
  });
});

describe('contrato de cache: las claves a invalidar son las que FotosPozosService crea de verdad', () => {
  let guardadas;
  let eventos;
  const baseFoto = { fotoId: FOTO, estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', wellId: '14-0001', monitoringId: '', driveFileId: 'DRIVE_FILE_ID_0001', driveThumbId: 'DRIVE_THUMB_ID_0001' };
  beforeEach(() => {
    installAppsScriptFakes();
    global.Logger = { log: jest.fn() };
    Object.assign(global, M, Ops);
    eventos = [];
    global.fotosPozoEventosRepository_leerTodos = jest.fn(() => ({ eventos: eventos }));
    global.fotosService_bytesDeBase64 = Reemplazo.fotosService_bytesDeBase64;
    global.fotosService_esJpeg = Reemplazo.fotosService_esJpeg;
    global.fotosService_limpiar = Reemplazo.fotosService_limpiar;
    guardadas = {};
    const cache = {
      get: (k) => (Object.prototype.hasOwnProperty.call(guardadas, k) ? guardadas[k] : null),
      put: (k, v) => { guardadas[k] = v; },
      putAll: (lote) => { Object.keys(lote).forEach((k) => { guardadas[k] = lote[k]; }); },
      remove: (k) => { delete guardadas[k]; }
    };
    global.CacheService = { getScriptCache: () => cache };
    global.fotosPozosRepository_buscarVisiblePorFotoId = jest.fn().mockReturnValue(Object.assign({}, baseFoto));
    global.fotosPozosRepository_listarVisiblesPorEntidad = jest.fn().mockReturnValue([Object.assign({ fuente: 'CAMPO_APP', tipoFoto: 'OTRA', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoValor: '' }, baseFoto)]);
    global.fotosPozosRepository_listarVisiblesBase = jest.fn().mockReturnValue([Object.assign({}, baseFoto)]);
    global.fotosPozosRepository_contarVisiblesPorEntidad = jest.fn().mockReturnValue({ '14-0001': 1 });
    global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
  });

  test('listar, miniatura, imagen completa y resumen: el conjunto EXACTO de claves de la foto + el resumen es el que la moderacion declara', () => {
    Service.fotosPozosService_listar('14-0001', '', 'recientes');
    Service.fotosPozosService_obtenerImagen(FOTO, 'thumb');
    Service.fotosPozosService_obtenerImagen(FOTO, 'full');
    Service.fotosPozosService_resumen();
    expect(Object.keys(guardadas).sort()).toEqual(M.fotosPozosModeracion_clavesCacheAInvalidar(FOTO).slice().sort());
  });

  test('la imagen FULL no se cachea (solo thumb)', () => {
    Service.fotosPozosService_obtenerImagen(FOTO, 'full');
    expect(Object.keys(guardadas).filter((k) => k.indexOf('fotospozos_t_') === 0)).toEqual([]);
  });

  const retirada = () => ({ eventoId: uuid(700), secuencia: 1, evento: 'RETIRADA', fotoId: FOTO, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', motivoTexto: '', solicitudId: '', resolucion: '', email: 'm@x.com', nombre: 'M', timestampUtc: '2026-10-27T10:00:00.000Z', clientRequestId: 'c-00000001' });

  test('una foto retirada deja de servirse AUNQUE su metadata siga en cache (los eventos se consultan antes que el cache)', () => {
    expect(Service.fotosPozosService_obtenerImagen(FOTO, 'thumb')).toMatchObject({ ok: true });
    expect(guardadas['fotospozos_m_' + FOTO]).toBeDefined();
    eventos.push(retirada());
    expect(Service.fotosPozosService_obtenerImagen(FOTO, 'thumb')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
    expect(Service.fotosPozosService_obtenerImagen(FOTO, 'full')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
  });

  test('invalidar esas claves alcanza para el listado y el resumen: una foto retirada deja de listarse y de contarse', () => {
    Service.fotosPozosService_listar('14-0001', '', 'recientes');
    Service.fotosPozosService_resumen();
    eventos.push(retirada());
    M.fotosPozosModeracion_clavesCacheAInvalidar(FOTO).forEach((k) => { global.CacheService.getScriptCache().remove(k); });
    expect(Service.fotosPozosService_listar('14-0001', '', 'recientes')).toMatchObject({ ok: true, total: 0 });
    expect(Service.fotosPozosService_resumen()).toEqual({});
  });

  test('los prefijos y la clave del resumen coinciden con el codigo fuente de FotosPozosService', () => {
    const fuente = leer('backend', 'src', 'FotosPozosService.js');
    expect(fuente).toContain("'" + M.FOTOS_MOD_CACHE_META_PREFIJO + "'");
    expect(fuente).toContain("'" + M.FOTOS_MOD_CACHE_THUMB_PREFIJO + "'");
    expect(fuente).toContain("FOTOS_POZOS_RESUMEN_CLAVE = '" + M.FOTOS_MOD_CACHE_RESUMEN_CLAVE + "'");
  });

  test('FotosPozosService no cachea ninguna otra clave que dependa de la foto o de la galeria (si agrega una, este test obliga a sumarla a la invalidacion)', () => {
    const fuente = sinComentarios(leer('backend', 'src', 'FotosPozosService.js'));
    const primerosArgumentos = (fuente.match(/cache\.(?:put|get|remove|putAll)\(\s*[^,)]+/g) || []).map((x) => x.replace(/\s+/g, ' ').replace(/^cache\.\w+\(/, ''));
    const unicos = Array.from(new Set(primerosArgumentos)).sort();
    expect(unicos).toEqual(["'fotospozos_m_' + fotoId", 'FOTOS_POZOS_RESUMEN_CLAVE', 'claveThumb', 'k', 'lote'].sort());
  });
});

describe('integracion dominio + repositorio sobre una hoja en memoria', () => {
  let hojas;
  const ISO = '2026-10-27T15:00:00.000Z';
  const MODERADOR = { email: 'mod@x.com', nombre: 'Moderador', permisos: { fotos: true, fotos_moderar: true } };
  const CARGA = { email: 'ana@x.com', nombre: 'Ana', permisos: { fotos: true, fotos_carga: true } };
  let n;

  beforeEach(() => {
    installAppsScriptFakes();
    global.Logger = { log: jest.fn() };
    Object.assign(global, Eventos);
    hojas = instalarSheetsFalsos({ FotosPozoEventos: [Eventos.FOTOS_POZO_EVENTOS_COLUMNAS] });
    n = 900;
  });

  const bases = () => ({ [FOTO]: { fotoId: FOTO, estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', wellId: '14-0001', monitoringId: '' } });

  // como lo hara E8-3: todo dentro del lock; leer + derivar + buscar clientRequestId + planificar + escribir
  function ejecutar(comando, actor, basesMap) {
    return Eventos.fotosPozoEventosRepository_conLock(() => {
      const todos = Eventos.fotosPozoEventosRepository_leerTodos().eventos;
      const plan = M.fotosPozosModeracion_planificar(comando, {
        email: actor.email, nombre: actor.nombre, permisos: actor.permisos, ahora: new Date(ISO),
        derivacion: M.fotosPozosModeracion_derivar(todos),
        obtenerBase: (id) => (basesMap || bases())[id] || null,
        existentes: Eventos.fotosPozoEventosRepository_buscarPorClientRequestId(actor.email, comando.clientRequestId),
        nuevoEventoId: () => uuid(n++)
      });
      if (plan.ok && plan.accion === 'ESCRIBIR') {
        plan.escrito = Eventos.fotosPozoEventosRepository_escribirEvento(plan.evento);
      }
      return plan;
    });
  }
  const estado = (b) => M.fotosPozosModeracion_estadoFoto((b || bases())[FOTO], M.fotosPozosModeracion_derivar(Eventos.fotosPozoEventosRepository_leerTodos().eventos));

  test('solicitar -> aprobar -> reponer: el estado se deriva de lo que quedo escrito en la hoja', () => {
    const s = ejecutar({ accion: 'SOLICITAR_RETIRO', fotoId: FOTO, motivoCodigo: 'OTRO', motivoTexto: 'razon', clientRequestId: 'sol-00000001' }, CARGA);
    expect(s).toMatchObject({ ok: true, accion: 'ESCRIBIR' });
    expect(estado()).toMatchObject({ visible: true, solicitudAbierta: { motivoCodigo: 'OTRO' } });
    const a = ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: s.escrito.eventoId, resolucion: 'APROBADO', clientRequestId: 'res-00000001' }, MODERADOR);
    expect(a).toMatchObject({ ok: true, invalidaCache: true });
    expect(estado()).toMatchObject({ visible: false, estado: 'RETIRADA' });
    ejecutar({ accion: 'REPONER', fotoId: FOTO, clientRequestId: 'rep-00000001' }, MODERADOR);
    expect(estado()).toMatchObject({ visible: true, estado: 'ACTIVA' });
    expect(hojas.FotosPozoEventos.filas.slice(1).map((f) => f[Eventos.FOTOS_POZO_EVENTOS_COLUMNAS.indexOf('secuencia')])).toEqual([1, 2, 3]);
  });

  test('el retry exacto (misma hoja) no escribe otra fila y reconoce el evento original', () => {
    const c = { accion: 'RETIRAR', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: 'ret-00000001' };
    const a = ejecutar(c, MODERADOR);
    const b = ejecutar(c, MODERADOR);
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(b.evento.eventoId).toBe(a.escrito.eventoId);
    expect(hojas.FotosPozoEventos.filas).toHaveLength(2);
  });

  test('la fila escrita lleva email SOLO en la hoja y la derivacion que sale de ella no lo contiene', () => {
    ejecutar({ accion: 'RETIRAR', fotoId: FOTO, motivoCodigo: 'PRIVACIDAD', clientRequestId: 'ret-00000002' }, MODERADOR);
    expect(JSON.stringify(hojas.FotosPozoEventos.filas)).toContain('mod@x.com');
    const der = M.fotosPozosModeracion_derivar(Eventos.fotosPozoEventosRepository_leerTodos().eventos);
    expect(JSON.stringify(der)).not.toContain('mod@x.com');
    expect(estado()).toMatchObject({ visible: false, requiereRevisionBorrado: true });
  });

  test('baseline OCULTA + una hoja con eventos: la reposicion sigue prohibida y no se escribe nada', () => {
    const ocultas = { [FOTO]: Object.assign(bases()[FOTO], { estado: 'OCULTA' }) };
    const r = ejecutar({ accion: 'REPONER', fotoId: FOTO, clientRequestId: 'rep-00000002' }, MODERADOR, ocultas);
    expect(r).toMatchObject({ ok: false, code: 'REPOSICION_NO_PERMITIDA' });
    expect(hojas.FotosPozoEventos.filas).toHaveLength(1);
  });

  test('hoja corrupta (secuencia duplicada): el plan escribe pero el repositorio LANZA sin escribir; la foto afectada queda no derivable', () => {
    const cols = Eventos.FOTOS_POZO_EVENTOS_COLUMNAS;
    const mk = (extra) => cols.map((c) => (extra[c] === undefined ? '' : extra[c]));
    const fila1 = mk({ eventoId: uuid(801), secuencia: 5, evento: 'RETIRADA', fotoId: FOTO, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', email: 'x@x.com' });
    const fila2 = mk({ eventoId: uuid(802), secuencia: 5, evento: 'REPUESTA', fotoId: FOTO, entidadTipo: 'WELL', entidadId: '14-0001', email: 'x@x.com' });
    hojas = instalarSheetsFalsos({ FotosPozoEventos: [cols, fila1, fila2] });
    expect(estado().visible).toBe(false);
    expect(() => ejecutar({ accion: 'SOLICITAR_RETIRO', fotoId: uuid(2), motivoCodigo: 'DUPLICADA', clientRequestId: 'sol-00000009' }, CARGA, { [uuid(2)]: { fotoId: uuid(2), estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', wellId: '14-0002' } })).toThrow(/no se escribio nada/);
    expect(hojas.FotosPozoEventos.filas).toHaveLength(3);
  });
});

describe('E8-3: alcance del cableado (backend si; frontend, storage, Drive y legacy no)', () => {
  const api = sinComentarios(leer('backend', 'src', 'Api.js'));
  const ACCIONES = ['solicitarRetiroFotoPozo', 'retirarFotoPozo', 'resolverRetiroFotoPozo', 'reponerFotoPozo', 'getHistorialFotoPozo', 'getFotosPozosPendientesModeracion', 'getFotosPozosRetiradasModeracion', 'getFotoPozoModeracion'];
  const jsFrontend = () => fs.readdirSync(path.join(raiz, 'js')).filter((f) => /\.js$/.test(f));

  test('Api.js enruta las 8 acciones y exporta sus handlers', () => {
    ACCIONES.forEach((a) => { expect(api).toContain("body.action === '" + a + "'"); });
    const Api = require('../src/Api');
    ['handleSolicitarRetiroFotoPozo', 'handleRetirarFotoPozo', 'handleResolverRetiroFotoPozo', 'handleReponerFotoPozo', 'handleGetHistorialFotoPozo', 'handleGetFotosPozosPendientesModeracion', 'handleGetFotosPozosRetiradasModeracion', 'handleGetFotoPozoModeracion']
      .forEach((h) => { expect(typeof Api[h]).toBe('function'); });
  });

  test('Api.js y los archivos de moderacion no crean la hoja, ni usan Drive / Telegram / FotosPozosCambios', () => {
    expect(api).not.toMatch(/setupFotosPozoEventosSheet|DriveApp|trashFotoPozo|setTrashed|FotosPozosCambios|fotosPozosCambiosRepository|Telegram/);
    ['FotosPozosModeracionOperaciones.js', 'FotosPozosModeracionService.js', 'FotosPozoEventosRepository.js'].forEach((f) => {
      expect(sinComentarios(leer('backend', 'src', f))).not.toMatch(/DriveApp|trashFotoPozo|setTrashed|Telegram|sendTelegram/);
    });
  });

  // E8-4 agrego la UI: el frontend conoce el permiso y las acciones SOLO en api.js (wrappers) y en los dos archivos de moderacion. Nada mas (ni app.js, ni fotosPozos.js) decide permisos ni llama endpoints.
  test('fotos_moderar existe en el backend de permisos y en el frontend SOLO en la logica de moderacion', () => {
    ['AuthService.js', 'SheetUserRepository.js'].forEach((f) => {
      expect(leer('backend', 'src', f)).toContain('fotos_moderar');
    });
    const conPermiso = jsFrontend().filter((f) => !/\.test\.js$/.test(f) && /fotos_moderar/.test(sinComentarios(leer('js', f))));
    expect(conPermiso).toEqual(['fotosModeracionLogic.js']);
  });

  test('las acciones de moderacion las llaman solo api.js (wrappers) y los archivos de moderacion', () => {
    const conAccion = jsFrontend().filter((f) => !/\.test\.js$/.test(f) && ACCIONES.some((a) => sinComentarios(leer('js', f)).indexOf(a) >= 0));
    expect(conAccion).toEqual(['api.js']);
    const usan = (re) => jsFrontend().filter((f) => !/\.test\.js$/.test(f) && re.test(sinComentarios(leer('js', f)))).sort();
    // E8-5: la galeria (fotosModeracion.js) sugiere, retira y muestra el historial; la pantalla de fotos pendientes (fotosModeracionCola.js) lista, aprueba / rechaza y repone. Nadie mas.
    expect(usan(/api(SolicitarRetiro|RetirarFoto|GetHistorialFoto)\w*\(/)).toEqual(['api.js', 'fotosModeracion.js']);
    expect(usan(/api(ResolverRetiro|GetFotosPozosPendientes|GetFotosPozosRetiradas)\w*\(/)).toEqual(['api.js', 'fotosModeracionCola.js']);
    expect(usan(/api(ReponerFoto|GetFotoPozoModeracion)\w*\(/)).toEqual(['api.js', 'fotosModeracion.js', 'fotosModeracionCola.js']);
  });

  test('FotosPozosService consume SOLO las lecturas de la moderacion: no escribe eventos ni conoce sus constantes', () => {
    const svc = sinComentarios(leer('backend', 'src', 'FotosPozosService.js'));
    expect(svc).toMatch(/fotosPozosModeracionOps_cargarDerivacion/);
    expect(svc).not.toMatch(/fotosPozoEventosRepository_escribirEvento|FOTOS_MOD_|planificar|fotosPozosModeracionOps_ejecutar|RETIRO_SOLICITADO|REPUESTA/);
  });

  test('el repositorio de FotosPozos, el storage y el importador no conocen la moderacion', () => {
    ['FotosPozosRepository.js', 'FotosStorageClient.js', 'FotosPozosImport.js'].forEach((f) => {
      expect(sinComentarios(leer('backend', 'src', f))).not.toMatch(/Moderacion|fotosPozoEventos|FOTOS_MOD_/);
    });
    ['StorageApi.js', 'StorageDrive.js', 'StorageConfig.js'].forEach((f) => {
      expect(leer('storage', 'src', f)).not.toMatch(/Moderacion|FotosPozoEventos/);
    });
  });

  test('FotosPozosCambios es LEGACY: los archivos nuevos no la leen ni la escriben, y nada del backend actual la escribe', () => {
    ['FotosPozosModeracionService.js', 'FotosPozoEventosRepository.js'].forEach((f) => {
      expect(sinComentarios(leer('backend', 'src', f))).not.toMatch(/FotosPozosCambios|fotosPozosCambiosRepository|FOTOS_POZOS_CAMBIOS/);
    });
    fs.readdirSync(path.join(raiz, 'backend', 'src')).filter((f) => /\.js$/.test(f) && f !== 'FotosPozosRepository.js').forEach((f) => {
      expect(sinComentarios(leer('backend', 'src', f))).not.toMatch(/fotosPozosCambiosRepository_registrar/);
    });
  });

  test('el dominio y el repositorio nuevos no tocan storage, Drive, imagenes ni URLs', () => {
    ['FotosPozosModeracionService.js', 'FotosPozoEventosRepository.js'].forEach((f) => {
      expect(sinComentarios(leer('backend', 'src', f))).not.toMatch(/DriveApp|UrlFetchApp|fotosStorageClient|driveFileId|driveThumbId|base64|Base64|getBlob|trashFotoPozo|setTrashed|sha1/);
    });
  });

  test('el dominio es puro: no usa Sheets, locks, cache ni Utilities (el repositorio es quien habla con Apps Script)', () => {
    expect(sinComentarios(leer('backend', 'src', 'FotosPozosModeracionService.js'))).not.toMatch(/SpreadsheetApp|LockService|CacheService|Utilities\.|Logger\.|PropertiesService/);
  });

  test('el repositorio nuevo no tiene logica de estado: no deriva ACTIVA / RETIRADA ni decide visibilidad', () => {
    expect(sinComentarios(leer('backend', 'src', 'FotosPozoEventosRepository.js'))).not.toMatch(/'ACTIVA'|'RETIRADA'|visible/);
  });

  test('USUARIOS_COLUMNAS_PERMISO suma SOLO fotos_moderar (justo despues de fotos_carga)', () => {
    expect(leer('backend', 'src', 'SheetUserRepository.js')).toContain("var USUARIOS_COLUMNAS_PERMISO = ['perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];");
  });

  test('un cambio de nombre de columna de eventos que el dominio lee seria detectado: el repositorio produce todo lo que el dominio parsea', () => {
    const e = Eventos.fotosPozoEventosRepository_eventoDesdeFila(Eventos.FOTOS_POZO_EVENTOS_COLUMNAS.map(() => ''), Eventos.fotosPozoEventosRepository_indiceColumnas(Eventos.FOTOS_POZO_EVENTOS_COLUMNAS), 2);
    ['eventoId', 'secuencia', 'evento', 'fotoId', 'entidadTipo', 'entidadId', 'solicitudId', 'resolucion', 'motivoCodigo', 'motivoTexto', 'nombre', 'timestampUtc'].forEach((campo) => {
      expect(Object.prototype.hasOwnProperty.call(e, campo)).toBe(true);
    });
  });
});

describe('documentacion', () => {
  const doc = () => leer('docs', 'fotos-pozos-moderacion.md');
  test.each([
    ['baseline'], ['append-only'], ['RETIRO_SOLICITADO'], ['REPUESTA'], ['PRIVACIDAD'], ['clientRequestId'], ['NO_DERIVABLE'], ['FotosPozosCambios'], ['POR_REVISAR'], ['E10'], ['fotospozos_m_'], ['reconcili']
  ])('docs/fotos-pozos-moderacion.md menciona %s', (tema) => {
    expect(doc()).toContain(tema);
  });

  test('registra la reconciliacion productiva de FotosPozos (4.116 / 4.116) y el rollout (v46)', () => {
    expect(doc()).toMatch(/4\.116 \/ 4\.116/);
    expect(doc()).toMatch(/v46/);
    expect(doc()).toMatch(/E8 PRODUCTIVO/);
  });

  test('la documentacion no contiene emails', () => {
    expect(doc()).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
