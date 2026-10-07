// SpreadsheetApp / LockService en memoria, solo lo que usan los repositorios de
// fotos: abrir por id, hojas por nombre, rangos de valores y formatos, filas,
// insertSheet. Permite testear repositorios y flujos de punta a punta sin Google.
function crearHoja(nombre, filas) {
  const hoja = {
    nombre,
    filas: (filas || []).map((f) => f.slice()),
    formatos: {},
    congeladas: 0,
    getName() { return this.nombre; },
    getMaxRows() { return Math.max(this.filas.length, 1000); },
    getLastRow() { return this.filas.length; },
    getLastColumn() { return this.filas.reduce((m, f) => Math.max(m, f.length), 0); },
    getDataRange() { const self = this; return { getValues: () => self.filas.map((f) => f.slice()) }; },
    setFrozenRows(n) { this.congeladas = n; },
    getRange(fila, col, nFilas, nCols) {
      const self = this;
      return {
        getValues() {
          const out = [];
          for (let r = 0; r < nFilas; r++) {
            const origen = self.filas[fila - 1 + r] || [];
            const f = [];
            for (let c = 0; c < nCols; c++) { f.push(origen[col - 1 + c] === undefined ? '' : origen[col - 1 + c]); }
            out.push(f);
          }
          return out;
        },
        setValues(vals) {
          vals.forEach((f, r) => {
            while (self.filas.length < fila + r) { self.filas.push([]); }
            const destino = self.filas[fila - 1 + r];
            f.forEach((v, c) => { destino[col - 1 + c] = v; });
          });
        },
        setNumberFormat(fmt) { self.formatoColumnas = self.formatoColumnas || []; self.formatoColumnas.push({ fila, col, nFilas, nCols, fmt }); },
        setNumberFormats(fmts) { fmts.forEach((f, r) => f.forEach((v, c) => { self.formatos[(fila + r) + ':' + (col + c)] = v; })); }
      };
    }
  };
  return hoja;
}

function instalarSheetsFalsos(hojasIniciales) {
  const hojas = {};
  Object.keys(hojasIniciales || {}).forEach((n) => { hojas[n] = crearHoja(n, hojasIniciales[n]); });
  global.getSpreadsheetId = () => 'SPREADSHEET_DE_PRUEBA';
  global.SpreadsheetApp = {
    openById: () => ({
      getSheetByName: (n) => hojas[n] || null,
      insertSheet: (n) => { hojas[n] = crearHoja(n, []); return hojas[n]; }
    }),
    flush: () => {}
  };
  global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  return hojas;
}

module.exports = { instalarSheetsFalsos, crearHoja };
