// Fake-DOM event registry: records addEventListener, fires via dispatch().

// Listeners the page registered, keyed by the object it called addEventListener
// on (`this`, so a test's `{ ...doc }` copy keys to itself). dispatch() reads them.
const LISTENERS = new WeakMap();

// Spread into a fake element or document to give it recording listener methods.
export const listenerMethods = {
  addEventListener(type, fn) {
    if (!LISTENERS.has(this)) LISTENERS.set(this, new Map());
    const byType = LISTENERS.get(this);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(fn);
  },
  removeEventListener(type, fn) {
    const list = LISTENERS.get(this)?.get(type);
    const i = list ? list.indexOf(fn) : -1;
    if (i !== -1) list.splice(i, 1);
  },
};

// Snapshot of the `type` listeners registered on `target`.
export function listeners(target, type) {
  return [...(LISTENERS.get(target)?.get(type) || [])];
}

// Call `target`'s `type` listeners in registration order with one shared event,
// as the browser would. No bubbling: aim at the node the page bound. Returns
// the event so callers can read defaultPrevented.
export function dispatch(target, type, init = {}) {
  const event = {
    type, target, key: '',
    ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { event.defaultPrevented = true; },
    stopPropagation() {},
    ...init,
  };
  for (const fn of listeners(target, type)) fn(event);
  return event;
}
