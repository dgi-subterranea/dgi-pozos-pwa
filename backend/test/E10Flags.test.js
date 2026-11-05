// E10-1: interruptores de E10, fail-closed y separados de E9. Solo el texto EXACTO 'SI' enciende; ausente / vacio / otro valor / error al leer = apagado.
const fs = require('fs');
const path = require('path');
const F = require('../src/E10Flags');

function propiedades(valores, falla) {
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => {
        if (falla) { throw new Error('PropertiesService caido'); }
        return Object.prototype.hasOwnProperty.call(valores, k) ? valores[k] : null;
      }
    })
  };
}
afterEach(() => { delete global.PropertiesService; });

describe.each([
  ['E10_ADMIN_USUARIOS_ACTIVO', 'adminUsuariosActivo'],
  ['E10_GESTION_EXTERNOS_ACTIVO', 'gestionExternosActivo']
])('%s', (propiedad, fn) => {
  test('solo el texto exacto SI lo enciende', () => {
    propiedades({ [propiedad]: 'SI' });
    expect(F['e10Flags_' + fn]()).toBe(true);
  });

  test.each([['NO'], [''], ['si'], ['Si'], [' SI'], ['SI '], ['true'], ['1'], ['SÍ'], ['ENCENDIDO'], ['on']])('el valor %j NO lo enciende (fail-closed)', (valor) => {
    propiedades({ [propiedad]: valor });
    expect(F['e10Flags_' + fn]()).toBe(false);
  });

  test('propiedad ausente -> apagado', () => {
    propiedades({});
    expect(F['e10Flags_' + fn]()).toBe(false);
  });

  test('error al leer las propiedades -> apagado (nunca lanza)', () => {
    propiedades({ [propiedad]: 'SI' }, true);
    expect(() => F['e10Flags_' + fn]()).not.toThrow();
    expect(F['e10Flags_' + fn]()).toBe(false);
  });

  test('sin PropertiesService en absoluto -> apagado', () => {
    delete global.PropertiesService;
    expect(F['e10Flags_' + fn]()).toBe(false);
  });
});

test('los dos flags son independientes entre si y de los de E9', () => {
  propiedades({ E10_ADMIN_USUARIOS_ACTIVO: 'SI' });
  expect(F.e10Flags_adminUsuariosActivo()).toBe(true);
  expect(F.e10Flags_gestionExternosActivo()).toBe(false);
  propiedades({ ITF_E9_ACTIVO: 'SI' });
  expect(F.e10Flags_adminUsuariosActivo()).toBe(false);
  expect(F.e10Flags_gestionExternosActivo()).toBe(false);
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'E10Flags.js'), 'utf8').replace(/\/\/.*$/gm, '');
  expect(fuente).not.toMatch(/ITF_E9|itfService|itfPreflight/);
});

describe('EMAIL_VERIFIED_MODO', () => {
  test.each([['OBSERVAR', 'OBSERVAR'], ['EXIGIR', 'EXIGIR'], ['exigir', 'EXIGIR'], [' Exigir ', 'EXIGIR'], ['observar', 'OBSERVAR']])('%j -> %s (valido)', (valor, modo) => {
    propiedades({ EMAIL_VERIFIED_MODO: valor });
    expect(F.e10Flags_emailVerifiedModo()).toEqual({ modo, origen: 'VALIDO' });
  });

  test.each([[null], [''], ['   ']])('ausente o vacio (%j) -> OBSERVAR (estado inicial del rollout)', (valor) => {
    propiedades(valor === null ? {} : { EMAIL_VERIFIED_MODO: valor });
    expect(F.e10Flags_emailVerifiedModo()).toEqual({ modo: 'OBSERVAR', origen: 'AUSENTE' });
  });

  test.each([['OBSERBAR'], ['EXIGIR.'], ['true'], ['SI'], ['1'], ['bloquear']])('valor invalido %j -> OBSERVAR con origen INVALIDO (nunca bloquea logins por un error de tipeo)', (valor) => {
    propiedades({ EMAIL_VERIFIED_MODO: valor });
    expect(F.e10Flags_emailVerifiedModo()).toEqual({ modo: 'OBSERVAR', origen: 'INVALIDO' });
  });

  test('error al leer la propiedad -> OBSERVAR (ausente)', () => {
    propiedades({}, true);
    expect(F.e10Flags_emailVerifiedModo()).toEqual({ modo: 'OBSERVAR', origen: 'AUSENTE' });
  });
});

test('el archivo solo LEE propiedades: ninguna API de escritura', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'E10Flags.js'), 'utf8').replace(/\/\/.*$/gm, '');
  expect(fuente).not.toMatch(/\.(setProperty|setProperties|deleteProperty|deleteAllProperties)\s*\(/);
  expect(fuente).toMatch(/getScriptProperties\(\)\.getProperty\(/);
});
