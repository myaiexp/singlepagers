// No-deps browser-environment stub for running yatzy.html's <script> under node:vm.
// jsdom is intentionally NOT a dependency of singlepagers (no build/test toolchain),
// so this provides just enough of localStorage/document/timers to load the page.

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
    querySelectorAll: () => makeNodeList(),
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

// Build a vm sandbox with the browser globals yatzy.html's script actually uses.
// setTimeout is a no-op: load-time smoke only cares about synchronous top-level code,
// and firing dice-animation callbacks would need far more DOM fidelity.
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
    crypto: globalThis.crypto,
    alert() {},
    confirm() { return false; },
    prompt() { return null; },
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
