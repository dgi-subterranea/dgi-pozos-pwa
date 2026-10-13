// SpreadsheetApp / LockService en memoria, solo lo que usan los repositorios de
// fotos: abrir por id, hojas por nombre, rangos de valores y formatos, filas,
// insertSheet. Permite testear repositorios y flujos de punta a punta sin Google.
//
// Grilla FISICA de columnas (como la real): una hoja nueva de Sheets trae 26 columnas; getMaxColumns() las informa e insertColumnsAfter() agrega columnas VACIAS
// (las filas que tienen celdas despues de esa posicion se corren, como en Sheets). getLastColumn() es otra cosa: la ultima columna con CONTENIDO.
// Para simular una hoja de otro ancho: hoja.columnasFisicas = 18. Con hoja.estricta = true, leer o escribir un rango que se sale de la grilla LANZA (como el error
// "The coordinates or dimensions of the range are invalid" de Sheets): sirve para probar que el codigo agranda la grilla ANTES de escribir, sin depender de si la
// escritura fuera de la grilla se expande sola o falla. Por defecto (estricta = false) no se verifica nada, como siempre, para no tocar los demas tests.
function crearHoja(nombre, filas) {
  const anchoInicial = (filas || []).reduce((m, f) => Math.max(m, f.length), 0);
  const hoja = {
    nombre,
    filas: (filas || []).map((f) => f.slice()),
    formatos: {},
    congeladas: 0,
    columnasFisicas: Math.max(26, anchoInicial),
    estricta: false,
    getName() { return this.nombre; },
    getMaxRows() { return Math.max(this.filas.length, 1000); },
    getMaxColumns() { return Math.max(this.columnasFisicas, this.getLastColumn()); },
    insertColumnsAfter(posicion, cantidad) {
      if (!Number.isInteger(posicion) || posicion < 0 || posicion > this.getMaxColumns() || !Number.isInteger(cantidad) || cantidad < 1) {
        throw new Error('insertColumnsAfter: argumentos invalidos (' + posicion + ', ' + cantidad + ')');
      }
      this.filas.forEach((f) => { if (f.length > posicion) { f.splice(posicion, 0, ...new Array(cantidad).fill('')); } });
      this.columnasFisicas = this.getMaxColumns() + cantidad;
    },
    getLastRow() { return this.filas.length; },
    getLastColumn() { return this.filas.reduce((m, f) => Math.max(m, f.length), 0); },
    getDataRange() { const self = this; return { getValues: () => self.filas.map((f) => f.slice()) }; },
    setFrozenRows(n) { this.congeladas = n; },
    getRange(fila, col, nFilas, nCols) {
      const self = this;
      const verificarGrilla = () => {
        if (self.estricta === true && (col < 1 || col + nCols - 1 > self.getMaxColumns())) {
          throw new Error('The coordinates or dimensions of the range are invalid (columnas ' + col + '-' + (col + nCols - 1) + ' de ' + self.getMaxColumns() + ')');
        }
      };
      return {
        getValues() {
          verificarGrilla();
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
          verificarGrilla();
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
