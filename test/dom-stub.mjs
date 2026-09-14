// No-deps browser stub: fake DOM, vm sandbox, and page-script loader for tests.
// jsdom is intentionally NOT a dependency of singlepagers (no build/test toolchain),
// so this provides just enough of localStorage/document/timers to load the page.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import vm from 'node:vm';

export function createLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    key(i) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

// A forgiving fake DOM element: known props behave; unknown members return a
// chainable factory so calls like el.querySelector('.x').textContent = '…' don't throw.
function makeElement() {
  const props = {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    children: [],
    textContent: '', innerHTML: '', innerText: '', value: '',
    disabled: false, checked: false, className: '', id: '',
    appendChild(c) { return c; },
    removeChild(c) { return c; },
    insertBefore(c) { return c; },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    focus() {}, blur() {}, select() {}, remove() {}, click() {},
  };
  return new Proxy(props, {
    get(target, prop) {
      if (prop === 'querySelector') return () => makeElement();
      if (prop === 'querySelectorAll' || prop === 'getElementsByClassName' || prop === 'getElementsByTagName') {
        return () => makeNodeList();
      }
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => makeElement();
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}

// Set-backed classList for the elements a test needs to observe. Not the stub
// default: palaute branches on classList.contains('hidden'), and its tests are
// written against the stub's always-false contains().
export function recordingClassList() {
  const names = new Set();
  return {
    add(...c) { c.forEach((n) => names.add(n)); },
    remove(...c) { c.forEach((n) => names.delete(n)); },
    toggle(n, force) {
      const on = force === undefined ? !names.has(n) : !!force;
      if (on) names.add(n); else names.delete(n);
      return on;
    },
    contains(n) { return names.has(n); },
  };
}

// Array-like NodeList that yields a fake element for any index, so fixed-size loops
// (e.g. the 5 dice) never hit `undefined.textContent`.
export function makeNodeList(n = 5) {
  const arr = Array.from({ length: n }, () => makeElement());
  return new Proxy(arr, {
    get(t, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return prop in t ? t[prop] : makeElement();
      return t[prop];
    },
  });
}

export function createDocument() {
  return {
    getElementById: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll(selector) {
      // No HTML is parsed, so reference-panel tiles do not exist. The default
      // 5-node list makes syncReferencePanel read catScores[NaN] and abort init.
      if (String(selector).includes('reference-item')) return [];
      return makeNodeList();
    },
    getElementsByClassName: () => makeNodeList(),
    getElementsByTagName: () => makeNodeList(),
    createElement: () => makeElement(),
    body: makeElement(),
    head: makeElement(),
    documentElement: makeElement(),
    addEventListener() {},
    removeEventListener() {},
  };
}

// Build a vm sandbox with the browser globals the pages under test (yatzy.html, palaute.html) use.
// setTimeout is a no-op: load-time smoke only cares about synchronous top-level code,
// and firing dice-animation callbacks would need far more DOM fidelity. A clean
// yatzy boot therefore leaves isRolling true (init's opening roll starts but never
// settles); tests that call rollDice after load must fire or replace setTimeout,
// or reset isRolling.
// ECMAScript builtins (Math/JSON/Date/crypto) are copied in — vm contexts do not
// inherit them, and seat-id generation / scoring need them.
export function createSandbox(seed) {
  const sandbox = {
    localStorage: createLocalStorage(seed),
    document: createDocument(),
    console,
    Math,
    JSON,
    Date,
    Promise,
    crypto: globalThis.crypto,
    alert() {},
    confirm() { return false; },
    prompt() { return null; },
    scrollTo() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

// First attribute-free <script>…</script> body. A CDN tag with `src` is skipped
// because it is `<script src=…>`, not `<script>`.
export function extractInlineScript(html, filename = 'html') {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`no inline <script> block found in ${filename}`);
  return m[1];
}

// Load a page's inline script into a fresh sandbox. `patch(sandbox)` runs before
// the script so tests can inject ExcelJS, timers, or spies. A load-time exception
// is captured as `loadError` so callers can assert the page booted cleanly.
export function loadPage(htmlPath, { seed = {}, patch } = {}) {
  const filename = basename(htmlPath);
  const code = extractInlineScript(readFileSync(htmlPath, 'utf8'), filename);
  const sandbox = createSandbox(seed);
  if (typeof patch === 'function') patch(sandbox);
  vm.createContext(sandbox);
  let loadError;
  try {
    vm.runInContext(code, sandbox, { filename: `${filename}#script` });
  } catch (err) {
    loadError = err;
  }
  const run = (src) => vm.runInContext(src, sandbox);
  return { sandbox, run, loadError };
}

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
