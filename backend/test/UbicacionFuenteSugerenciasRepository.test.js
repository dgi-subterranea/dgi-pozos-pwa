// Repositorio de la hoja UbicacionFuenteSugerencias: esquema, setup idempotente y fail-closed, lectura, escritura append-only (una fila, texto plano) y que NO se ejecuta solo.
const fs = require('fs');
const path = require('path');
const { armarSug } = require('./sugerenciasHelper');
const { crearHoja } = require('./fakeSheets');

let t;
let Repo;
beforeEach(() => { t = armarSug(); Repo = t.RepoSug; });
afterEach(() => { jest.restoreAllMocks(); });

const COLUMNAS = ['sugerenciaId', 'secuencia', 'evento', 'wellId', 'fuenteTipo', 'x', 'y', 'accionSugerida', 'motivo', 'email', 'nombre', 'timestampUtc', 'clientRequestId', 'versionVista'];
const evento = (extra) => Object.assign({
  sugerenciaId: '11111111-1111-4111-8111-111111111111', secuencia: 1, evento: 'PROPUESTA', wellId: '14-0001', fuenteTipo: 'REPORTE_POZOS', x: 2486460.782, y: 6310651.228, accionSugerida: 'ACEPTAR',
  motivo: '', email: 'lee@x.com', nombre: 'Lee', timestampUtc: '2026-10-14T14:32:10.123Z', clientRequestId: 'req-000001', versionVista: 0
}, extra || {});

describe('esquema', () => {
  test('son exactamente 14 columnas, sin estado actual ni "resuelta por/en" (se derivan del log) ni decisionId (se deduce de sug-<id>)', () => {
    expect(Repo.UBICACION_FUENTE_SUGERENCIAS_COLUMNAS).toEqual(COLUMNAS);
    expect(Repo.UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.join(' ')).not.toMatch(/estado|resuelta|decisionId|padronPeriodo|causa/i);
  });

  test('los nombres y el orden se buscan por el texto del encabezado: reordenar o poner mayusculas no rompe', () => {
    const header = COLUMNAS.slice().reverse().map((c) => ' ' + c.toUpperCase() + ' ');
    expect(Repo.ubicacionFuenteSugerenciasRepository_planEsquema(header).ok).toBe(true);
    const idx = Repo.ubicacionFuenteSugerenciasRepository_indiceColumnas(header);
    expect(idx.sugerenciaId).toBe(13);
    expect(idx.versionVista).toBe(0);
  });

  test('si falta o se repite una columna: esquema inesperado (fail-closed)', () => {
    expect(Repo.ubicacionFuenteSugerenciasRepository_planEsquema(COLUMNAS.slice(1))).toMatchObject({ ok: false, faltantes: ['sugerenciaId'] });
    expect(Repo.ubicacionFuenteSugerenciasRepository_planEsquema(COLUMNAS.concat(['email']))).toMatchObject({ ok: false, repetidas: ['email'] });
    expect(Repo.ubicacionFuenteSugerenciasRepository_planEsquema(null).ok).toBe(false);
  });

  test('columnas EXTRA al final se toleran (asi se podrian agregar campos sin migrar)', () => {
    expect(Repo.ubicacionFuenteSugerenciasRepository_planEsquema(COLUMNAS.concat(['decisionId'])).ok).toBe(true);
  });
});

describe('setupUbicacionFuenteSugerenciasSheet', () => {
  test('crea la hoja con el encabezado exacto y la fila 1 congelada; no escribe filas de datos', () => {
    const t2 = armarSug({ sinHoja: true });
    expect(t2.RepoSug.setupUbicacionFuenteSugerenciasSheet()).toBe('CREADA');
    const h = t2.hojas.UbicacionFuenteSugerencias;
    expect(h.filas).toEqual([COLUMNAS]);
    expect(h.congeladas).toBe(1);
  });

  test('es idempotente: la segunda vez no crea nada ni toca el encabezado ni las filas', () => {
    const t2 = armarSug({ sinHoja: true });
    t2.RepoSug.setupUbicacionFuenteSugerenciasSheet();
    t2.hojas.UbicacionFuenteSugerencias.filas.push(['dato', 1]);
    const antes = JSON.stringify(t2.hojas.UbicacionFuenteSugerencias.filas);
    expect(t2.RepoSug.setupUbicacionFuenteSugerenciasSheet()).toBe('YA_EXISTE');
    expect(JSON.stringify(t2.hojas.UbicacionFuenteSugerencias.filas)).toBe(antes);
    expect(Object.keys(t2.hojas)).toEqual(['UbicacionFuenteSugerencias']);
  });

  test('una hoja existente correcta con filas: no se borra, no se reordena, no se modifica', () => {
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento());
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento({ secuencia: 2, evento: 'CANCELADA' }));
    const antes = JSON.stringify(t.hojas.UbicacionFuenteSugerencias.filas);
    expect(Repo.setupUbicacionFuenteSugerenciasSheet()).toBe('YA_EXISTE');
    expect(JSON.stringify(t.hojas.UbicacionFuenteSugerencias.filas)).toBe(antes);
  });

  test('fail-closed: una hoja existente con otro esquema LANZA y no se toca; una hoja existente vacia tambien', () => {
    const t2 = armarSug({ sinHoja: true });
    t2.hojas.UbicacionFuenteSugerencias = crearHoja('UbicacionFuenteSugerencias', [['sugerenciaId', 'otraCosa'], ['a', 1]]);
    const original = JSON.stringify(t2.hojas.UbicacionFuenteSugerencias.filas);
    expect(() => t2.RepoSug.setupUbicacionFuenteSugerenciasSheet()).toThrow(/esquema inesperado/);
    expect(JSON.stringify(t2.hojas.UbicacionFuenteSugerencias.filas)).toBe(original);
    const t3 = armarSug({ sinHoja: true });
    t3.hojas.UbicacionFuenteSugerencias = crearHoja('UbicacionFuenteSugerencias', []);
    expect(() => t3.RepoSug.setupUbicacionFuenteSugerenciasSheet()).toThrow(/vacia/);
    expect(t3.hojas.UbicacionFuenteSugerencias.filas).toEqual([]);
  });

  test('no toca ninguna otra hoja (ni la de decisiones)', () => {
    const t2 = armarSug({ sinHoja: true });
    t2.hojas.Usuarios = crearHoja('Usuarios', [['email'], ['a@x.com']]);
    t2.hojas.UbicacionFuenteDecisiones = crearHoja('UbicacionFuenteDecisiones', [['x'], ['y']]);
    t2.RepoSug.setupUbicacionFuenteSugerenciasSheet();
    expect(t2.hojas.Usuarios.filas).toEqual([['email'], ['a@x.com']]);
    expect(t2.hojas.UbicacionFuenteDecisiones.filas).toEqual([['x'], ['y']]);
  });

  test('NO se ejecuta sola: ningun otro archivo de backend/src la invoca', () => {
    const dir = path.join(__dirname, '..', 'src');
    fs.readdirSync(dir).filter((f) => f !== 'UbicacionFuenteSugerenciasRepository.js').forEach((f) => {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/setupUbicacionFuenteSugerenciasSheet\s*\(/);
    });
  });
});

describe('hoja inexistente o con esquema roto: fail-closed (nunca se escribe)', () => {
  test('sin hoja: lectura y escritura lanzan indicando el setup, y no crean nada', () => {
    const t2 = armarSug({ sinHoja: true });
    expect(() => t2.RepoSug.ubicacionFuenteSugerenciasRepository_listar()).toThrow(/setupUbicacionFuenteSugerenciasSheet/);
    expect(() => t2.RepoSug.ubicacionFuenteSugerenciasRepository_agregar(evento())).toThrow(/setupUbicacionFuenteSugerenciasSheet/);
    expect(Object.keys(t2.hojas)).toEqual([]);
  });

  test('con el esquema roto, escribir lanza y no agrega nada', () => {
    t.hojas.UbicacionFuenteSugerencias.filas[0] = COLUMNAS.slice(1);
    expect(() => Repo.ubicacionFuenteSugerenciasRepository_agregar(evento())).toThrow(/esquema esperado/);
    expect(t.hojas.UbicacionFuenteSugerencias.filas).toHaveLength(1);
  });

  test('sin la hoja de sugerencias, el modulo de decisiones sigue funcionando (son hojas independientes)', () => {
    const t2 = armarSug({ sinHojaSug: true });
    expect(t2.decidirDirecto('ACEPTAR', { fuenteTipo: 'REPORTE_POZOS', x: t2.filasDec ? 2486460.782 : 0, y: 6310651.228 }).ok).toBe(true);
  });
});

describe('lectura', () => {
  test('lee los eventos como objetos (numeros como numeros, texto recortado, fecha ISO) en el orden de la hoja', () => {
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento({ nombre: '  Lee  ' }));
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento({ secuencia: 2, evento: 'CANCELADA' }));
    const l = Repo.ubicacionFuenteSugerenciasRepository_listar();
    expect(l.map((e) => e.secuencia)).toEqual([1, 2]);
    expect(l[0]).toEqual(evento());
  });

  test('numeros con coma o como texto se leen igual; vacio o no numerico = null (nada se corrige en silencio)', () => {
    t.hojas.UbicacionFuenteSugerencias.filas.push(COLUMNAS.map((c) => ({ sugerenciaId: 'a'.repeat(10), secuencia: '3', evento: 'PROPUESTA', x: '2486460,782', y: 'roto', versionVista: '' }[c] || '')));
    const e = Repo.ubicacionFuenteSugerenciasRepository_listar()[0];
    expect(e).toMatchObject({ secuencia: 3, x: 2486460.782, y: null, versionVista: null });
  });

  test('una fila completamente vacia se salta; una fila a medias NO (el servicio la marca inconsistente)', () => {
    t.hojas.UbicacionFuenteSugerencias.filas.push(COLUMNAS.map(() => ''));
    t.hojas.UbicacionFuenteSugerencias.filas.push(COLUMNAS.map((c) => (c === 'sugerenciaId' ? 'solo-el-id-1' : '')));
    expect(Repo.ubicacionFuenteSugerenciasRepository_listar()).toHaveLength(1);
  });

  test('si Sheets convirtio el timestamp en fecha, se lee igual en ISO', () => {
    t.hojas.UbicacionFuenteSugerencias.filas.push(COLUMNAS.map((c) => (c === 'timestampUtc' ? new Date('2026-10-14T14:32:10.123Z') : (c === 'sugerenciaId' ? 'a'.repeat(10) : ''))));
    expect(Repo.ubicacionFuenteSugerenciasRepository_listar()[0].timestampUtc).toBe('2026-10-14T14:32:10.123Z');
  });

  test('las columnas reordenadas a mano se leen y se escriben en su lugar', () => {
    t.hojas.UbicacionFuenteSugerencias.filas[0] = COLUMNAS.slice().reverse();
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento());
    expect(Repo.ubicacionFuenteSugerenciasRepository_listar()[0]).toEqual(evento());
    expect(t.hojas.UbicacionFuenteSugerencias.filas[1][13]).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('escritura (append-only)', () => {
  test('agrega UNA fila al final y nunca modifica las anteriores', () => {
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento());
    const primera = JSON.stringify(t.hojas.UbicacionFuenteSugerencias.filas[1]);
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento({ secuencia: 2 }));
    expect(t.hojas.UbicacionFuenteSugerencias.filas).toHaveLength(3);
    expect(JSON.stringify(t.hojas.UbicacionFuenteSugerencias.filas[1])).toBe(primera);
  });

  test('formatos: texto plano ("@") en todo menos secuencia, x, y y versionVista (un motivo con "=" nunca es una formula)', () => {
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento({ motivo: '=1+1' }));
    const fmt = (c) => t.hojas.UbicacionFuenteSugerencias.formatos['2:' + (COLUMNAS.indexOf(c) + 1)];
    COLUMNAS.forEach((c) => expect(fmt(c)).toBe(Repo.UBICACION_FUENTE_SUGERENCIAS_FORMATOS_NUMERICOS[c] || '@'));
    expect(fmt('motivo')).toBe('@');
    expect(fmt('timestampUtc')).toBe('@');
    expect(t.hojas.UbicacionFuenteSugerencias.filas[1][COLUMNAS.indexOf('motivo')]).toBe('=1+1');
  });

  test('los valores vacios quedan como celda vacia (versionVista de un rechazo)', () => {
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento({ versionVista: null }));
    expect(t.hojas.UbicacionFuenteSugerencias.filas[1][COLUMNAS.indexOf('versionVista')]).toBe('');
  });

  test('el repositorio no toma el lock por su cuenta (lo toma el servicio) y comparte el MISMO lock de script que las decisiones', () => {
    Repo.ubicacionFuenteSugerenciasRepository_agregar(evento());
    expect(t.locks.tomados).toBe(0);
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'UbicacionFuenteSugerenciasRepository.js'), 'utf8');
    expect(src).not.toMatch(/LockService/);
  });
});
