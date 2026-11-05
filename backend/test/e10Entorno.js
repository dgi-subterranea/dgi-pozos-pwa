// Entorno de tests de E10-1: Apps Script falso + hojas Usuarios / UsuariosEventos EN MEMORIA + los modulos REALES (catalogo, dominio, flags, repositorios, AuthService, servicio administrativo).
// Cache con TTL (reloj controlable) para probar la invalidacion inmediata y el tombstone. Nada toca Google.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const PERMISOS_DE_SIEMPRE = ['perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];
const COLS_ACTUALES = ['email', 'nombre', 'estado', 'fecha_alta'].concat(PERMISOS_DE_SIEMPRE);
const COLS_NUEVAS = ['tipo', 'version', 'actualizado_utc', 'actualizado_por', 'usuarios_admin', 'mapa'];
const COLS_E10 = COLS_ACTUALES.concat(COLS_NUEVAS);

// fila de la hoja a partir de {email, nombre, estado, tipo, version, permisos: [ids en SI], ...}. Las columnas que el header no tiene se ignoran.
function filaDe(header, u) {
  const ids = u.permisos || [];
  return header.map((c) => {
    if (c === 'email') { return u.email; }
    if (c === 'nombre') { return u.nombre === undefined ? 'Nombre' : u.nombre; }
    if (c === 'estado') { return u.estado === undefined ? 'activo' : u.estado; }
    if (c === 'fecha_alta') { return u.fecha_alta === undefined ? '2026-01-01' : u.fecha_alta; }
    if (c === 'tipo') { return u.tipo === undefined ? 'INTERNO' : u.tipo; }
    if (c === 'version') { return u.version === undefined ? 1 : u.version; }
    if (c === 'actualizado_utc') { return u.actualizado_utc === undefined ? '2026-11-05T00:00:00.000Z' : u.actualizado_utc; }
    if (c === 'actualizado_por') { return u.actualizado_por === undefined ? 'migracion:E10-1' : u.actualizado_por; }
    return ids.indexOf(c) >= 0 ? 'SI' : 'NO';
  });
}

function crearCacheConTtl() {
  const estado = { ahora: 0, store: {} };
  return {
    estado,
    avanzar(segundos) { estado.ahora += segundos; },
    get(k) { const e = estado.store[k]; return e && e.vence > estado.ahora ? e.valor : null; },
    put(k, v, ttl) { estado.store[k] = { valor: v, vence: estado.ahora + (ttl === undefined ? 600 : ttl) }; },
    remove(k) { delete estado.store[k]; },
    claves() { return Object.keys(estado.store).filter((k) => estado.store[k].vence > estado.ahora); }
  };
}

const ADMIN1 = 'admin1@x.com';
const ADMIN2 = 'admin2@x.com';

// opciones: {header (columnas de Usuarios), usuarios: [{...}], eventos: true | false | filas, propiedades: {...}}
function crearEntornoE10(opciones) {
  const o = opciones || {};
  installAppsScriptFakes();
  const cache = crearCacheConTtl();
  global.CacheService = { getScriptCache: () => cache };
  global.Logger = { log: jest.fn() };

  // modulos reales (en Apps Script son archivos del mismo proyecto: espacio global compartido)
  Object.assign(global, require('../src/PermisosCatalogo'));
  Object.assign(global, require('../src/UsuariosDominio'));
  Object.assign(global, require('../src/E10Flags'));
  Object.assign(global, require('../src/SheetUserRepository'));
  const Eventos = require('../src/UsuariosEventosRepository');
  Object.assign(global, Eventos);
  const Auth = require('../src/AuthService');
  Object.assign(global, Auth);
  const Servicio = require('../src/UsuariosAdminService');
  Object.assign(global, Servicio);

  const header = o.header || COLS_E10;
  const usuarios = o.usuarios || [
    { email: ADMIN1, nombre: 'Admin Uno', permisos: PERMISOS_DE_SIEMPRE.concat(['mapa', 'usuarios_admin']) },
    { email: ADMIN2, nombre: 'Admin Dos', permisos: PERMISOS_DE_SIEMPRE.concat(['mapa', 'usuarios_admin']) },
    { email: 'interno@x.com', nombre: 'Interno Consulta', permisos: ['perfil', 'datos', 'ubicacion', 'mapa'] },
    { email: 'externo@x.com', nombre: 'Externo Tecnico', tipo: 'EXTERNO', permisos: ['perfil', 'perfil_subir', 'ubicacion', 'mapa'] },
    { email: 'baja@x.com', nombre: 'Usuario De Baja', estado: 'inactivo', permisos: ['perfil'] }
  ];
  const hojasIniciales = { Usuarios: [header].concat(usuarios.map((u) => filaDe(header, u))) };
  if (o.eventos !== false) {
    hojasIniciales.UsuariosEventos = [Eventos.USUARIOS_EVENTOS_COLUMNAS].concat(Array.isArray(o.eventos) ? o.eventos : []);
  }
  const hojas = instalarSheetsFalsos(hojasIniciales);
  global.__propiedades = Object.assign({}, o.propiedades || {});
  global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (Object.prototype.hasOwnProperty.call(global.__propiedades, k) ? global.__propiedades[k] : null) }) };
  return { hojas, cache, header, Auth, Servicio, Eventos };
}

const ACTOR = { email: ADMIN1, nombre: 'Admin Uno' };

module.exports = { crearEntornoE10, crearCacheConTtl, filaDe, PERMISOS_DE_SIEMPRE, COLS_ACTUALES, COLS_NUEVAS, COLS_E10, ADMIN1, ADMIN2, ACTOR };
