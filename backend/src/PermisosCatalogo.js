// PermisosCatalogo (E10-1): FUENTE CANONICA de los permisos de la aplicacion. Datos puros + funciones puras: sin Sheets, sin cache, sin Script Properties.
// Todo lo que necesite la lista de permisos (el parser de la hoja Usuarios, el acceso por request, los permisos de login/checkSession, la migracion, el preflight, la futura administracion de
// usuarios) la DERIVA de aca; ninguna otra pieza del backend mantiene una lista propia (un test lo exige). El frontend tampoco: es fail-closed por construccion (todo chequeo es sobre una clave que
// puede no existir) y el panel de administracion de E10-2 pedira el catalogo al backend.
//
// Cada permiso:
//   id                 id tecnico = texto del encabezado de la columna en la hoja Usuarios
//   nombre, descripcion  lo que ve el administrador
//   modulo             agrupacion en el panel
//   categoria          'lectura' | 'escritura' | 'moderacion' | 'administracion'
//   aplicableInterno   boolean
//   aplicableExterno   boolean. NO significa "se concede a los externos": solo expresa compatibilidad potencial. false = tecnicamente prohibido (techo duro: lo rechaza el backend aunque
//                      alguien intente asignarlo por API o por edicion administrativa, y NUNCA es efectivo para un EXTERNO aunque la hoja lo tenga en SI)
//                      E10-3 (politica de autoridad): un EXTERNO autenticado consulta, propone y carga segun sus permisos, pero NUNCA valida, modera, anula lo ajeno ni administra. Por eso son
//                      aplicableExterno = false los permisos de categoria 'moderacion' y 'administracion' (perfil_validar, ubicacion_validar, fotos_moderar, observaciones_anular, usuarios_admin).
//                      `tipo` describe UNICAMENTE a personas autenticadas: PUBLICO / ANONIMO no es un tipo de usuario (no esta en `Usuarios`, no tiene sesion ni permisos individuales; tendra una politica
//                      publica global con su propia whitelist, ver docs/e10-publico-anonimo-diseno.md).
//   dependeDe          ids que deben estar en SI para que el permiso tenga sentido (lo valida la administracion; el login/acceso NO lo aplica: no cambia lo que los usuarios actuales ya pueden)
//   critico            exige confirmacion reforzada en la administracion
//   orden              orden de presentacion
//
// EL ORDEN DE CARGA de los archivos de Apps Script no esta garantizado: nada de este archivo depende de otro al cargar y todo se expone como FUNCIONES (nunca como constantes derivadas).
var PERMISOS_CATALOGO_DATOS = [
  { id: 'perfil', nombre: 'Ver ITF vigente y disponibilidad', descripcion: 'Ver el ITF vigente de un pozo y si tiene ITF; descargar ITF.', modulo: 'Perfil / ITF', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 10 },
  { id: 'perfil_subir', nombre: 'Proponer ITF', descripcion: 'Proponer un ITF nuevo para un pozo (queda pendiente de validacion) y retirar la propia propuesta.', modulo: 'Perfil / ITF', categoria: 'escritura', aplicableInterno: true, aplicableExterno: true, dependeDe: ['perfil'], critico: false, orden: 11 },
  { id: 'perfil_validar', nombre: 'Validar ITF', descripcion: 'Aprobar, rechazar, retirar y revertir ITF.', modulo: 'Perfil / ITF', categoria: 'moderacion', aplicableInterno: true, aplicableExterno: false, dependeDe: ['perfil'], critico: true, orden: 12 },
  { id: 'datos', nombre: 'Ver ficha completa del pozo', descripcion: 'Ver la ficha registral del pozo, incluidos titular y domicilios, y buscar por titular.', modulo: 'Datos', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: true, orden: 20 },
  { id: 'ubicacion', nombre: 'Ver ubicacion y fuentes', descripcion: 'Ver la ubicacion del pozo, sus fuentes y el historial de correcciones y sugerencias (solo lectura).', modulo: 'Ubicacion', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 30 },
  { id: 'ubicacion_corregir', nombre: 'Proponer correcciones y sugerencias', descripcion: 'Proponer correcciones de ubicacion y sugerir o cancelar decisiones sobre las fuentes.', modulo: 'Ubicacion', categoria: 'escritura', aplicableInterno: true, aplicableExterno: true, dependeDe: ['ubicacion'], critico: false, orden: 31 },
  { id: 'ubicacion_validar', nombre: 'Validar correcciones y decidir fuentes', descripcion: 'Validar, rechazar y revertir correcciones; decidir y resolver sugerencias sobre las fuentes.', modulo: 'Ubicacion', categoria: 'moderacion', aplicableInterno: true, aplicableExterno: false, dependeDe: ['ubicacion'], critico: true, orden: 32 },
  { id: 'mapa', nombre: 'Ver mapa de pozos, Cerca mio y seleccion', descripcion: 'Acceder al dataset general del mapa (puntos de todos los pozos y ubicaciones validadas) para el mapa, Cerca mio y la seleccion.', modulo: 'Mapa', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 40 },
  { id: 'ne', nombre: 'Ver niveles estaticos', descripcion: 'Ver la red y las mediciones de niveles estaticos.', modulo: 'Niveles estaticos', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 50 },
  { id: 'fotos', nombre: 'Ver fotos de pozos', descripcion: 'Ver la galeria de fotos de un pozo.', modulo: 'Fotos', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 60 },
  { id: 'fotos_carga', nombre: 'Subir fotos de pozos', descripcion: 'Subir fotos de un pozo y pedir el retiro de las propias.', modulo: 'Fotos', categoria: 'escritura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 61 },
  { id: 'fotos_moderar', nombre: 'Moderar fotos de pozos', descripcion: 'Retirar, reponer y resolver pedidos de retiro de fotos.', modulo: 'Fotos', categoria: 'moderacion', aplicableInterno: true, aplicableExterno: false, dependeDe: ['fotos'], critico: true, orden: 62 },
  { id: 'observaciones', nombre: 'Ver observaciones', descripcion: 'Ver las observaciones de un pozo.', modulo: 'Observaciones', categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 70 },
  { id: 'observaciones_agregar', nombre: 'Agregar observaciones', descripcion: 'Agregar observaciones a un pozo y anular las propias.', modulo: 'Observaciones', categoria: 'escritura', aplicableInterno: true, aplicableExterno: true, dependeDe: ['observaciones'], critico: false, orden: 71 },
  { id: 'observaciones_anular', nombre: 'Anular observaciones', descripcion: 'Anular las observaciones de cualquier persona y ver el texto de las anuladas.', modulo: 'Observaciones', categoria: 'moderacion', aplicableInterno: true, aplicableExterno: false, dependeDe: ['observaciones'], critico: true, orden: 72 },
  { id: 'reemplazo', nombre: 'Evaluar reemplazos', descripcion: 'Ver y registrar evaluaciones de reemplazo y sus fotos.', modulo: 'Reemplazos', categoria: 'escritura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden: 80 },
  { id: 'usuarios_admin', nombre: 'Administrar usuarios y permisos', descripcion: 'Listar, crear, editar, dar de baja y reactivar usuarios y cambiar sus permisos; consultar la auditoria administrativa.', modulo: 'Administracion', categoria: 'administracion', aplicableInterno: true, aplicableExterno: false, dependeDe: [], critico: true, orden: 90 }
];

var PERMISOS_CATALOGO_CATEGORIAS = ['lectura', 'escritura', 'moderacion', 'administracion'];
var PERMISOS_CATALOGO_TIPOS = ['INTERNO', 'EXTERNO'];

function permisosCatalogo_copiar(p) {
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    modulo: p.modulo,
    categoria: p.categoria,
    aplicableInterno: p.aplicableInterno,
    aplicableExterno: p.aplicableExterno,
    dependeDe: p.dependeDe.slice(),
    critico: p.critico,
    orden: p.orden
  };
}

// Lista ordenada por `orden` (copias: quien la reciba no puede alterar el catalogo).
function permisosCatalogo_lista() {
  return PERMISOS_CATALOGO_DATOS.map(permisosCatalogo_copiar).sort(function (a, b) { return a.orden - b.orden; });
}

function permisosCatalogo_ids() {
  return permisosCatalogo_lista().map(function (p) { return p.id; });
}

function permisosCatalogo_porId(id) {
  for (var i = 0; i < PERMISOS_CATALOGO_DATOS.length; i++) {
    if (PERMISOS_CATALOGO_DATOS[i].id === id) {
      return permisosCatalogo_copiar(PERMISOS_CATALOGO_DATOS[i]);
    }
  }
  return null;
}

function permisosCatalogo_existe(id) {
  return typeof id === 'string' && permisosCatalogo_porId(id) !== null;
}

// {id: false, ...} para TODOS los permisos del catalogo.
function permisosCatalogo_vacios() {
  var vacios = {};
  permisosCatalogo_ids().forEach(function (id) { vacios[id] = false; });
  return vacios;
}

// Ids de los permisos que un EXTERNO nunca puede tener (aplicableExterno = false), en el orden del catalogo. DERIVADO del catalogo: ninguna otra pieza mantiene esta lista.
function permisosCatalogo_noAplicablesExterno() {
  return permisosCatalogo_lista().filter(function (p) { return p.aplicableExterno !== true; }).map(function (p) { return p.id; });
}

function permisosCatalogo_tipoValido(tipo) {
  return PERMISOS_CATALOGO_TIPOS.indexOf(tipo) >= 0;
}

// Lista de ids -> {id: true|false} (los que no estan, false). Ignora ids que no son del catalogo.
function permisosCatalogo_aObjeto(ids) {
  var o = permisosCatalogo_vacios();
  (ids || []).forEach(function (id) { if (Object.prototype.hasOwnProperty.call(o, id)) { o[id] = true; } });
  return o;
}

// {id: boolean} -> ids en true, en el orden del catalogo.
function permisosCatalogo_aLista(permisos) {
  var p = permisos || {};
  return permisosCatalogo_ids().filter(function (id) { return p[id] === true; });
}

// Valida un conjunto de permisos (ids en SI) para un tipo de usuario. Devuelve {ok, errores:[{codigo, permiso, detalle}]}. Codigos:
//   TIPO_INVALIDO               el tipo no es INTERNO ni EXTERNO
//   PERMISO_DESCONOCIDO         un id que no esta en el catalogo
//   PERMISOS_INCONSISTENTES     falta una dependencia (perfil_validar sin perfil, etc.)
//   TIPO_NO_PERMITE_PERMISO     el permiso no es aplicable a ese tipo (usuarios_admin con EXTERNO): REGLA DURA, siempre
function permisosCatalogo_validarConjunto(tipo, ids) {
  var errores = [];
  if (!permisosCatalogo_tipoValido(tipo)) {
    errores.push({ codigo: 'TIPO_INVALIDO', permiso: null, detalle: 'tipo debe ser INTERNO o EXTERNO' });
  }
  var lista = Array.isArray(ids) ? ids : [];
  if (!Array.isArray(ids)) {
    errores.push({ codigo: 'PERMISO_DESCONOCIDO', permiso: null, detalle: 'los permisos deben ser una lista' });
  }
  lista.forEach(function (id) {
    var p = permisosCatalogo_porId(id);
    if (p === null) {
      errores.push({ codigo: 'PERMISO_DESCONOCIDO', permiso: String(id).slice(0, 40), detalle: 'permiso inexistente' });
      return;
    }
    if (tipo === 'EXTERNO' && p.aplicableExterno !== true) {
      errores.push({ codigo: 'TIPO_NO_PERMITE_PERMISO', permiso: id, detalle: 'un usuario EXTERNO no puede tener ' + id });
    }
    if (tipo === 'INTERNO' && p.aplicableInterno !== true) {
      errores.push({ codigo: 'TIPO_NO_PERMITE_PERMISO', permiso: id, detalle: 'un usuario INTERNO no puede tener ' + id });
    }
    p.dependeDe.forEach(function (dep) {
      if (lista.indexOf(dep) < 0) {
        errores.push({ codigo: 'PERMISOS_INCONSISTENTES', permiso: id, detalle: id + ' requiere ' + dep });
      }
    });
  });
  return { ok: errores.length === 0, errores: errores };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PERMISOS_CATALOGO_CATEGORIAS,
    PERMISOS_CATALOGO_TIPOS,
    permisosCatalogo_lista,
    permisosCatalogo_ids,
    permisosCatalogo_porId,
    permisosCatalogo_existe,
    permisosCatalogo_noAplicablesExterno,
    permisosCatalogo_vacios,
    permisosCatalogo_tipoValido,
    permisosCatalogo_aObjeto,
    permisosCatalogo_aLista,
    permisosCatalogo_validarConjunto
  };
}
