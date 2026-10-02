// Palaute export fixtures: a recording ExcelJS stand-in for the Excel-export tests.

// Chainable stand-in for ExcelJS cells/rows/columns so style() closures run
// without modelling fonts, fills, or alignments.
function excelChain() {
  const node = { getCell: () => excelChain(), getRow: () => excelChain() };
  return new Proxy(node, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      return () => excelChain();
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}

// Recording ExcelJS stand-in used by both export tests. `buffer` is what
// `xlsx.writeBuffer()` resolves to (empty by default; a non-empty buffer lets
// the xlsx download path look different from JSON).
export function createExcelJSStub({ buffer = new Uint8Array(0) } = {}) {
  const workbooks = [];
  class Workbook {
    constructor() {
      this.worksheets = [];
      workbooks.push(this);
    }
    addWorksheet(name) {
      const rows = [];
      const ws = {
        name,
        rows,
        addRow(r) { rows.push(r); return excelChain(); },
        getRow: () => excelChain(),
        getColumn: () => excelChain(),
        getCell: () => excelChain(),
        addConditionalFormatting() {},
        mergeCells() {},
      };
      this.worksheets.push(ws);
      return new Proxy(ws, {
        get(t, p) {
          if (p in t) return t[p];
          if (typeof p === 'symbol') return undefined;
          return () => excelChain();
        },
        set(t, p, v) { t[p] = v; return true; },
      });
    }
    get xlsx() {
      return { writeBuffer: async () => buffer };
    }
  }
  return { ExcelJS: { Workbook }, workbooks };
}
