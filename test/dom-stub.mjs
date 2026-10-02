// No-deps browser stub: fake DOM, vm sandbox, and page-script loader for tests.
// jsdom is intentionally NOT a dependency of singlepagers (no build/test toolchain),
// so this provides just enough of localStorage/document/timers to load the page.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import vm from 'node:vm';
import { listenerMethods } from './dom-events.mjs';

export { dispatch, listeners } from './dom-events.mjs';

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
// `stable` (stableElements' `descendants`) returns one node per selector until innerHTML is
// reassigned — a re-render replaces the descendants and their listeners, as in a
// real DOM — and records classList and focus() (`focused`), so a test can fire
// what the page bound and see which node it focused.
function makeElement({ stable = false } = {}) {
  const queries = new Map();
  const remember = (key, make) => {
    if (!stable) return make();
    if (!queries.has(key)) queries.set(key, make());
    return queries.get(key);
  };
  const props = {
    style: {},
    classList: stable
      ? recordingClassList()
      : { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    children: [],
    textContent: '', innerHTML: '', innerText: '', value: '',
    disabled: false, checked: false, className: '', id: '',
    ...(stable ? { focused: false } : {}),
    appendChild(c) { return c; },
    removeChild(c) { return c; },
    insertBefore(c) { return c; },
    setAttribute() {},
    getAttribute() { return null; },
    ...listenerMethods,
    focus() { if (stable) props.focused = true; },
    blur() { if (stable) props.focused = false; },
    select() {}, remove() {}, click() {},
  };
  return new Proxy(props, {
    get(target, prop) {
      if (prop === 'querySelector') return (sel) => remember(`one:${sel}`, () => makeElement({ stable }));
      if (prop === 'querySelectorAll') return (sel) => remember(`all:${sel}`, () => makeNodeList(5, { stable }));
      if (prop === 'getElementsByClassName' || prop === 'getElementsByTagName') return () => makeNodeList();
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => makeElement();
    },
    set(target, prop, value) {
      if (prop === 'innerHTML') queries.clear();
      target[prop] = value;
      return true;
    },
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
export function makeNodeList(n = 5, { stable = false } = {}) {
  const arr = Array.from({ length: n }, () => makeElement({ stable }));
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
    ...listenerMethods,
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

// --- sandbox patches --------------------------------------------------------
// Call these from loadPage's `patch` so they apply before the page script runs
// (spyOn is the exception: it wraps a function the page has already defined).
// Each returns the record it keeps, for the test to read afterwards.

// Make document[method] return the SAME element for a given key. The stub
// default hands out a fresh element per call, so a page's write
// (`getElementById('x').innerHTML = …`) would be unreadable afterwards.
// recordClasses gives each element a Set-backed classList (recordingClassList)
// so class toggles like `show` can be read back. `descendants` builds each
// element with stable querySelector/querySelectorAll results (see makeElement)
// and a recording classList throughout, so a test can fire the listeners and
// onclick the page bound beneath it. Returns the key → element Map.
export function stableElements(sandbox, { method = 'getElementById', recordClasses = false, descendants = false } = {}) {
  const elements = new Map();
  const lookup = sandbox.document[method].bind(sandbox.document);
  sandbox.document[method] = (key) => {
    if (!elements.has(key)) {
      const el = descendants ? makeElement({ stable: true }) : lookup(key);
      if (recordClasses) el.classList = recordingClassList();
      elements.set(key, el);
    }
    return elements.get(key);
  };
  return elements;
}

// Replace alert() with a recorder. Returns the array of messages, as strings.
export function captureAlerts(sandbox) {
  const alerts = [];
  sandbox.alert = (msg) => { alerts.push(String(msg)); };
  return alerts;
}

// Record every document.createElement call as { tag, el }. `onCreate(el, tag)`
// runs before the element is handed to the page, so a test can stub a method
// (an anchor's click) that the page calls straight away. Returns the array.
export function captureCreated(sandbox, onCreate) {
  const created = [];
  const create = sandbox.document.createElement.bind(sandbox.document);
  sandbox.document.createElement = (tag) => {
    const el = create(tag);
    if (typeof onCreate === 'function') onCreate(el, tag);
    created.push({ tag, el });
    return el;
  };
  return created;
}

// Replace Blob and URL.createObjectURL/revokeObjectURL with recorders. Each
// createObjectURL call appends { blob, type, text, url, revoked } and hands out
// a unique `blob:stub/N` url; revokeObjectURL(url) sets that entry's `revoked`.
// `text` joins the blob's string parts (a JSON export); binary parts (an xlsx
// buffer) contribute nothing. Returns the array of downloads.
export function captureDownloads(sandbox) {
  const downloads = [];
  sandbox.Blob = function Blob(parts = [], opts) {
    this.parts = parts;
    this.type = opts?.type || '';
    this.text = parts.map((p) => (typeof p === 'string' ? p : '')).join('');
  };
  sandbox.URL = {
    createObjectURL(blob) {
      const url = `blob:stub/${downloads.length + 1}`;
      downloads.push({ blob, type: blob.type, text: blob.text, url, revoked: false });
      return url;
    },
    revokeObjectURL(url) {
      const dl = downloads.find((d) => d.url === url);
      if (dl) dl.revoked = true;
    },
  };
  return downloads;
}

// Queue setTimeout callbacks instead of dropping them (the stub default), so a
// test decides when they fire. Each entry is { id, fn, ms, args }; clearTimeout
// removes it. flush() runs the callbacks queued so far, in order — anything they
// queue waits for the next flush(). Returns { timers, flush }.
export function queueTimers(sandbox) {
  const timers = [];
  let nextId = 1;
  sandbox.setTimeout = (fn, ms, ...args) => {
    const id = nextId++;
    timers.push({ id, fn, ms, args });
    return id;
  };
  sandbox.clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i !== -1) timers.splice(i, 1);
  };
  const flush = () => {
    for (const t of timers.splice(0)) {
      if (typeof t.fn === 'function') t.fn(...t.args);
    }
  };
  return { timers, flush };
}

// Wrap the page function `sandbox[name]` so each call is recorded and then
// forwarded. Call it after loadPage, once the page has defined the function. A
// top-level function declaration is a property of the context global, so the
// page's own internal calls resolve through it and are counted too. Returns
// { calls, count }: one args array per call, and the number of calls.
export function spyOn(sandbox, name) {
  const original = sandbox[name];
  if (typeof original !== 'function') throw new Error(`spyOn: sandbox.${name} is not a function`);
  const calls = [];
  sandbox[name] = (...args) => {
    calls.push(args);
    return original(...args);
  };
  return { calls, get count() { return calls.length; } };
}
