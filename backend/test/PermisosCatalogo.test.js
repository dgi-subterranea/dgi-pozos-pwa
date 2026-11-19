// E10-1: PermisosCatalogo es la FUENTE CANONICA de permisos. Estos tests fijan su contenido, sus reglas de validacion y que nadie mas mantenga una lista propia.
const fs = require('fs');
const path = require('path');
const C = require('../src/PermisosCatalogo');

const raiz = path.join(__dirname, '..', '..');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

describe('contenido del catalogo', () => {
  test('17 permisos: los 15 de siempre + mapa + usuarios_admin, ids unicos', () => {
    const ids = C.permisosCatalogo_ids();
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(17);
    expect(ids).toEqual(expect.arrayContaining(['perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'mapa', 'ne', 'fotos', 'fotos_carga', 'fotos_moderar', 'observaciones', 'observaciones_agregar', 'observaciones_anular', 'reemplazo', 'usuarios_admin']));
  });

  test('cada permiso trae todos los campos pedidos con el tipo correcto', () => {
    C.permisosCatalogo_lista().forEach((p) => {
      expect(Object.keys(p).sort()).toEqual(['aplicableExterno', 'aplicableInterno', 'categoria', 'critico', 'dependeDe', 'descripcion', 'id', 'modulo', 'nombre', 'orden']);
      expect(typeof p.id).toBe('string');
      expect(p.nombre.length).toBeGreaterThan(3);
      expect(p.descripcion.length).toBeGreaterThan(10);
      expect(p.modulo.length).toBeGreaterThan(2);
      expect(C.PERMISOS_CATALOGO_CATEGORIAS).toContain(p.categoria);
      expect(typeof p.aplicableInterno).toBe('boolean');
      expect(typeof p.aplicableExterno).toBe('boolean');
      expect(typeof p.critico).toBe('boolean');
      expect(Array.isArray(p.dependeDe)).toBe(true);
      expect(Number.isInteger(p.orden)).toBe(true);
    });
  });

  test('el orden de presentacion es estricto (sin repetidos) y la lista sale ordenada', () => {
    const ordenes = C.permisosCatalogo_lista().map((p) => p.orden);
    expect(ordenes).toEqual(ordenes.slice().sort((a, b) => a - b));
    expect(new Set(ordenes).size).toBe(ordenes.length);
  });

  test('las dependencias apuntan a permisos que existen y no hay ciclos', () => {
    const ids = C.permisosCatalogo_ids();
    C.permisosCatalogo_lista().forEach((p) => {
      p.dependeDe.forEach((d) => { expect(ids).toContain(d); expect(d).not.toBe(p.id); });
    });
  });

  test('categorias: las lecturas no escriben, las de escritura / moderacion dependen de su lectura y usuarios_admin es la unica de administracion', () => {
    const porId = (id) => C.permisosCatalogo_porId(id);
    ['perfil', 'datos', 'ubicacion', 'mapa', 'ne', 'fotos', 'observaciones'].forEach((id) => expect(porId(id).categoria).toBe('lectura'));
    ['perfil_subir', 'ubicacion_corregir', 'fotos_carga', 'observaciones_agregar'].forEach((id) => expect(porId(id).categoria).toBe('escritura'));
    ['perfil_validar', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular'].forEach((id) => expect(porId(id).categoria).toBe('moderacion'));
    expect(C.permisosCatalogo_lista().filter((p) => p.categoria === 'administracion').map((p) => p.id)).toEqual(['usuarios_admin']);
  });

  test('ubicacion es LECTURA y ubicacion_corregir es ESCRITURA (sugerir, cancelar y proponer)', () => {
    expect(C.permisosCatalogo_porId('ubicacion').categoria).toBe('lectura');
    expect(C.permisosCatalogo_porId('ubicacion_corregir').categoria).toBe('escritura');
    expect(C.permisosCatalogo_porId('ubicacion_corregir').dependeDe).toEqual(['ubicacion']);
  });

  test('usuarios_admin: aplicable a INTERNO, NO aplicable a EXTERNO (techo duro) y critico', () => {
    const a = C.permisosCatalogo_porId('usuarios_admin');
    expect(a).toMatchObject({ aplicableInterno: true, aplicableExterno: false, critico: true });
  });

  // E10-3 (politica de autoridad): un EXTERNO consulta, propone y carga, pero nunca valida, modera, anula lo ajeno ni administra.
  const RESERVADOS_A_INTERNO = ['perfil_validar', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular', 'usuarios_admin'];
  const NO_RESERVADOS = ['perfil', 'perfil_subir', 'datos', 'ubicacion', 'ubicacion_corregir', 'mapa', 'ne', 'fotos', 'fotos_carga', 'observaciones', 'observaciones_agregar', 'reemplazo'];

  test('E10-3: los permisos reservados a INTERNO son EXACTAMENTE estos 5 (y solo estos son no aplicables a EXTERNO)', () => {
    expect(C.permisosCatalogo_lista().filter((p) => p.aplicableExterno === false).map((p) => p.id).sort()).toEqual(RESERVADOS_A_INTERNO.slice().sort());
    expect(C.permisosCatalogo_noAplicablesExterno().slice().sort()).toEqual(RESERVADOS_A_INTERNO.slice().sort());
    RESERVADOS_A_INTERNO.forEach((id) => expect(C.permisosCatalogo_porId(id)).toMatchObject({ aplicableInterno: true, aplicableExterno: false, critico: true }));
  });

  test('E10-3: los 12 permisos que NO se reservan siguen siendo aplicables a EXTERNO (Gualde y Dietrich conservan los suyos)', () => {
    NO_RESERVADOS.forEach((id) => expect(C.permisosCatalogo_porId(id)).toMatchObject({ aplicableInterno: true, aplicableExterno: true }));
    expect(NO_RESERVADOS.length + RESERVADOS_A_INTERNO.length).toBe(C.permisosCatalogo_ids().length);
  });

  test('E10-3 INVARIANTE: todo permiso de categoria moderacion o administracion tiene aplicableExterno = false, y ninguno de lectura/escritura lo tiene', () => {
    C.permisosCatalogo_lista().forEach((p) => {
      const autoridad = p.categoria === 'moderacion' || p.categoria === 'administracion';
      expect({ id: p.id, aplicableExterno: p.aplicableExterno }).toEqual({ id: p.id, aplicableExterno: !autoridad });
    });
  });

  test('aplicableExterno solo expresa compatibilidad: no concede nada (el catalogo no tiene ninguna nocion de "paquete por defecto" ni de acceso externo)', () => {
    const fuente = fs.readFileSync(path.join(raiz, 'backend', 'src', 'PermisosCatalogo.js'), 'utf8');
    expect(sinComentarios(fuente)).not.toMatch(/porDefecto|defecto|plantilla|paquete/i);
  });

  test('las copias no alteran el catalogo', () => {
    const p = C.permisosCatalogo_porId('perfil');
    p.nombre = 'x';
    p.dependeDe.push('mapa');
    C.permisosCatalogo_lista()[0].orden = 999;
    expect(C.permisosCatalogo_porId('perfil').nombre).not.toBe('x');
    expect(C.permisosCatalogo_porId('perfil').dependeDe).toEqual([]);
  });
});

describe('funciones derivadas', () => {
  test('vacios: todos los ids en false', () => {
    const v = C.permisosCatalogo_vacios();
    expect(Object.keys(v)).toHaveLength(17);
    Object.keys(v).forEach((k) => expect(v[k]).toBe(false));
  });

  test('aObjeto / aLista son inversas, ignoran ids desconocidos y respetan el orden del catalogo', () => {
    const o = C.permisosCatalogo_aObjeto(['mapa', 'perfil', 'inexistente', 'usuarios_admin']);
    expect(o.mapa && o.perfil && o.usuarios_admin).toBe(true);
    expect(Object.keys(o)).toHaveLength(17);
    expect(C.permisosCatalogo_aLista(o)).toEqual(['perfil', 'mapa', 'usuarios_admin']);
    expect(C.permisosCatalogo_aLista(null)).toEqual([]);
    expect(C.permisosCatalogo_aLista({ perfil: 'SI', datos: 1, ne: true })).toEqual(['ne']);          // solo booleano estricto
  });

  test('existe / tipoValido', () => {
    expect(C.permisosCatalogo_existe('mapa')).toBe(true);
    ['', 'MAPA', 'x', null, undefined, 5, {}].forEach((v) => expect(C.permisosCatalogo_existe(v)).toBe(false));
    expect(C.permisosCatalogo_tipoValido('INTERNO')).toBe(true);
    expect(C.permisosCatalogo_tipoValido('EXTERNO')).toBe(true);
    ['interno', '', 'ADMIN', null].forEach((v) => expect(C.permisosCatalogo_tipoValido(v)).toBe(false));
  });
});

describe('validarConjunto', () => {
  const codigos = (r) => r.errores.map((e) => e.codigo);

  test('un conjunto coherente para un INTERNO es valido', () => {
    expect(C.permisosCatalogo_validarConjunto('INTERNO', ['perfil', 'perfil_subir', 'ubicacion', 'ubicacion_corregir', 'mapa', 'usuarios_admin'])).toEqual({ ok: true, errores: [] });
  });

  test('un EXTERNO con usuarios_admin se rechaza SIEMPRE (TIPO_NO_PERMITE_PERMISO)', () => {
    const r = C.permisosCatalogo_validarConjunto('EXTERNO', ['perfil', 'usuarios_admin']);
    expect(r.ok).toBe(false);
    expect(codigos(r)).toContain('TIPO_NO_PERMITE_PERMISO');
    expect(r.errores.find((e) => e.codigo === 'TIPO_NO_PERMITE_PERMISO').permiso).toBe('usuarios_admin');
  });

  test('un EXTERNO con cualquier permiso NO reservado es compatible; con uno reservado, TIPO_NO_PERMITE_PERMISO (E10-3)', () => {
    const otros = C.permisosCatalogo_ids().filter((id) => !C.permisosCatalogo_noAplicablesExterno().includes(id));
    expect(C.permisosCatalogo_validarConjunto('EXTERNO', otros).errores.filter((e) => e.codigo === 'TIPO_NO_PERMITE_PERMISO')).toEqual([]);
    ['perfil_validar', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular', 'usuarios_admin'].forEach((id) => {
      const r = C.permisosCatalogo_validarConjunto('EXTERNO', ['perfil', 'fotos', 'ubicacion', 'observaciones', id]);
      expect(r.errores.find((e) => e.codigo === 'TIPO_NO_PERMITE_PERMISO')).toMatchObject({ permiso: id });
    });
  });

  test.each([
    ['perfil_subir sin perfil', ['perfil_subir'], 'perfil'],
    ['perfil_validar sin perfil', ['perfil_validar'], 'perfil'],
    ['ubicacion_corregir sin ubicacion', ['ubicacion_corregir'], 'ubicacion'],
    ['ubicacion_validar sin ubicacion', ['ubicacion_validar'], 'ubicacion'],
    ['fotos_moderar sin fotos', ['fotos_moderar'], 'fotos'],
    ['observaciones_agregar sin observaciones', ['observaciones_agregar'], 'observaciones'],
    ['observaciones_anular sin observaciones', ['observaciones_anular'], 'observaciones']
  ])('%s -> PERMISOS_INCONSISTENTES', (_n, ids, dep) => {
    const r = C.permisosCatalogo_validarConjunto('INTERNO', ids);
    expect(r.ok).toBe(false);
    expect(r.errores[0]).toMatchObject({ codigo: 'PERMISOS_INCONSISTENTES', detalle: expect.stringContaining(dep) });
  });

  test('permiso inexistente -> PERMISO_DESCONOCIDO; tipo invalido -> TIPO_INVALIDO; lista que no es lista -> error', () => {
    expect(codigos(C.permisosCatalogo_validarConjunto('INTERNO', ['inventado']))).toEqual(['PERMISO_DESCONOCIDO']);
    expect(codigos(C.permisosCatalogo_validarConjunto('SUPERVISOR', ['perfil']))).toContain('TIPO_INVALIDO');
    expect(C.permisosCatalogo_validarConjunto('INTERNO', 'perfil').ok).toBe(false);
    expect(C.permisosCatalogo_validarConjunto('INTERNO', null).ok).toBe(false);
  });
});

describe('fuente UNICA: ninguna otra pieza mantiene una lista de permisos', () => {
  const archivos = (dir, ext) => fs.readdirSync(path.join(raiz, dir)).filter((f) => f.endsWith(ext) && !f.endsWith('.test.js')).map((f) => path.join(dir, f));
  const PERMISOS_CLAVE = ['perfil_subir', 'perfil_validar', 'ubicacion_corregir', 'ubicacion_validar', 'fotos_moderar', 'observaciones_agregar', 'observaciones_anular', 'usuarios_admin'];
  // cuenta el objeto literal {...} (sin anidar) con MAS claves de permiso (clave: valor): 4 o mas = una lista de permisos mantenida a mano; 0 si ninguno llega a 4
  const objetosConPermisos = (fuente) => (fuente.match(/\{[^{}]{0,900}\}/g) || []).reduce((m, bloque) => {
    const cuantos = PERMISOS_CLAVE.filter((p) => new RegExp('\b' + p + '\s*:').test(bloque)).length;
    return cuantos >= 4 ? Math.max(m, cuantos) : m;
  }, 0);

  test('backend: solo PermisosCatalogo.js enumera permisos (ni un arreglo ni un objeto literal con 4 o mas de ellos)', () => {
    archivos(path.join('backend', 'src'), '.js').filter((f) => !/PermisosCatalogo\.js$/.test(f)).forEach((f) => {
      const fuente = sinComentarios(fs.readFileSync(path.join(raiz, f), 'utf8'));
      const arreglos = fuente.match(/\[[^\]]{0,600}\]/g) || [];
      arreglos.forEach((a) => {
        const cuantos = PERMISOS_CLAVE.filter((p) => a.indexOf("'" + p + "'") >= 0).length;
        expect({ f, cuantos: cuantos >= 4 ? cuantos : 0 }).toEqual({ f, cuantos: 0 });
      });
      expect({ f, objeto: objetosConPermisos(fuente) }).toEqual({ f, objeto: 0 });
    });
  });

  test('frontend: ningun js/ mantiene una lista literal de permisos (el runtime es fail-closed sobre claves que pueden no existir)', () => {
    archivos('js', '.js').forEach((f) => {
      const fuente = sinComentarios(fs.readFileSync(path.join(raiz, f), 'utf8'));
      expect({ f, objeto: objetosConPermisos(fuente) }).toEqual({ f, objeto: 0 });
    });
  });

  test('el parser de la hoja Usuarios y AuthService derivan sus listas del catalogo (a llamada, no al cargar)', () => {
    const repo = fs.readFileSync(path.join(raiz, 'backend', 'src', 'SheetUserRepository.js'), 'utf8');
    const auth = fs.readFileSync(path.join(raiz, 'backend', 'src', 'AuthService.js'), 'utf8');
    expect(repo).toContain('permisosCatalogo_ids()');
    expect(repo).toContain('permisosCatalogo_vacios()');
    expect(auth).toContain('usuariosDominio_accesoEfectivo');
    expect(repo).not.toMatch(/var USUARIOS_COLUMNAS/);
  });

  test('Apps Script: el archivo carga solo, sin ninguna dependencia al cargar (el orden de carga no esta garantizado)', () => {
    const vm = require('vm');
    const ctx = vm.createContext({});
    expect(() => vm.runInContext(fs.readFileSync(path.join(raiz, 'backend', 'src', 'PermisosCatalogo.js'), 'utf8'), ctx, { filename: 'PermisosCatalogo.js' })).not.toThrow();
    expect(ctx.permisosCatalogo_ids()).toHaveLength(17);
  });
});
