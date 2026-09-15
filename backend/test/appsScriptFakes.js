// Fakes minimos de las globals de Apps Script, para poder testear
// AuthService/ProfileService/Api con Jest sin llamar nunca a Google,
// Drive ni Sheets de verdad. Se instalan como globals a proposito: asi
// es como funciona Apps Script en la practica (todos los archivos del
// proyecto comparten un unico espacio de nombres global), asi que esto
// imita la ejecucion real en vez de forzar un cambio de arquitectura
// solo para poder testear.
//
// Utilities.* usa crypto/Buffer reales de Node para que firmar/codificar
// y despues verificar/decodificar en el mismo test de un resultado
// consistente - no hace falta imitar byte a byte el formato interno de
// Apps Script, alcanza con que sea internamente coherente.

const crypto = require('crypto');

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let padded = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  return Buffer.from(padded, 'base64');
}

function createFakeCache() {
  const store = {};
  return {
    get: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    put: (key, value) => {
      store[key] = value;
    }
  };
}

function installAppsScriptFakes() {
  global.Utilities = {
    computeHmacSha256Signature: (value, key) => crypto.createHmac('sha256', key).update(value).digest(),
    base64EncodeWebSafe: base64UrlEncode,
    base64DecodeWebSafe: base64UrlDecode,
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    newBlob: (bytes) => {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      return { getDataAsString: () => buf.toString('utf8') };
    }
  };

  const fakeCache = createFakeCache();
  global.CacheService = {
    getScriptCache: () => fakeCache
  };

  global.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  global.getSessionSecret = () => 'test-session-secret';

  global.UrlFetchApp = { fetch: jest.fn() };
  global.sheetUserRepository_getUserStatus = jest.fn();
  global.logHistoryEvent = jest.fn();
  global.driveProfileRepository_getFile = jest.fn();
  global.profileService_getProfile = jest.fn();
  global.registryRepository_getWellRecord = jest.fn();
  global.registryService_getWellRecord = jest.fn();
  global.registryService_getWellLocation = jest.fn();
  global.registryRepository_getMetadata = jest.fn();
  global.registryService_getMetadata = jest.fn();
  global.nivelesEstaticosRepository_getPunto = jest.fn();
  global.nivelesEstaticosService_getPunto = jest.fn();
  global.verifySessionToken = jest.fn();
  global.isUserActive = jest.fn();
  global.getUserAccess = jest.fn();
  global.hasPermission = jest.fn();
}

module.exports = { installAppsScriptFakes };
