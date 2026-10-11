// Suggestion-dropdown interaction (audit #8965): palaute-suggestions.test.mjs
// covers distinctAnswers / suggestionsFor, but the four functions that turn a
// ranked list into a pick — showSuggest, hideSuggest, acceptSuggest,
// suggestKeydown — were never entered. Mutating acceptSuggest to skip the
// `current.free[key] = ta.value` write, or deleting the ArrowUp wrap-around,
// passed the full suite. Same no-deps vm harness; the dropdown itself is
// driven with a plain `{ value }` stand-in so the tests do not need a real
// textarea.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureCreated, stableElements, dispatch } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const KEY = 'best';
const ITEMS = [
  { text: 'musiikki', count: 3 },
  { text: 'ruoka', count: 2 },
  { text: 'sää', count: 1 },
];

function loadUi() {
  let created;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) { created = captureCreated(sandbox); },
  });
  return { run, created };
}

function seedState(run, { items = ITEMS, active = -1 } = {}) {
  run(`suggestState[${JSON.stringify(KEY)}] = {
         items: ${JSON.stringify(items)},
         active: ${active},
       };
       current = blankForm();
       globalThis.__ta = { value: '' };`);
}

test('acceptSuggest writes the picked text into the textarea and current.free', () => {
  const { run } = loadUi();
  seedState(run, { active: 0 });
  run(`acceptSuggest(${JSON.stringify(KEY)}, __ta, 0);`);
  assert.equal(run('__ta.value'), 'musiikki');
  assert.equal(run(`current.free[${JSON.stringify(KEY)}]`), 'musiikki');
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}]`), undefined,
    'accepting a pick dismisses the dropdown');
});

test('suggestKeydown ArrowDown past the end wraps to 0', () => {
  const { run } = loadUi();
  seedState(run, { active: ITEMS.length - 1 });
  run(`suggestKeydown({ key: 'ArrowDown', preventDefault() {} }, ${JSON.stringify(KEY)}, __ta);`);
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}].active`), 0);
});

test('suggestKeydown ArrowUp past the start wraps to the last item', () => {
  const { run } = loadUi();
  seedState(run, { active: 0 });
  run(`suggestKeydown({ key: 'ArrowUp', preventDefault() {} }, ${JSON.stringify(KEY)}, __ta);`);
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}].active`), ITEMS.length - 1);
});

test('suggestKeydown Enter with active >= 0 writes through acceptSuggest', () => {
  const { run } = loadUi();
  seedState(run, { active: 1 });
  run(`suggestKeydown({ key: 'Enter', preventDefault() {} }, ${JSON.stringify(KEY)}, __ta);`);
  assert.equal(run('__ta.value'), 'ruoka');
  assert.equal(run(`current.free[${JSON.stringify(KEY)}]`), 'ruoka');
});

test('suggestKeydown Escape clears suggestState for that key', () => {
  const { run } = loadUi();
  seedState(run, { active: 0 });
  run(`suggestKeydown({ key: 'Escape', preventDefault() {} }, ${JSON.stringify(KEY)}, __ta);`);
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}]`), undefined);
});

test('hideSuggest drops suggestState even when no box is in the DOM', () => {
  const { run } = loadUi();
  seedState(run);
  run(`hideSuggest(${JSON.stringify(KEY)});`);
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}]`), undefined);
});

// The dropdown is created, not parsed out of #entry. stableElements keeps the
// live textarea; captureCreated({ stable: true }) keeps the nodes showSuggest
// bound. The stub does not parse data-i out of innerHTML, so the test sets
// dataset.i the way the markup would have — the handler reads it at event time.
test('mousedown on a suggestion prevents default and accepts that item', () => {
  let byId;
  let created;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sb) {
      byId = stableElements(sb, { descendants: true });
      created = captureCreated(sb, undefined, { stable: true });
    },
  });
  run(`forms = ['musiikki', 'musiikki', 'musiikki', 'ruoka', 'ruoka', 'sää'].map(t => {
         const f = blankForm();
         f.free.best = t;
         return f;
       });
       current = blankForm();
       renderEntry();`);
  const ta = byId.get('entry').querySelector('#ft-best');
  dispatch(ta, 'focus');
  const box = created.find(c => c.el.className === 'suggest')?.el;
  assert.ok(box, 'focus opens a suggestion box');
  const item = box.querySelectorAll('.suggest-item')[0];
  item.dataset.i = '0';
  const expected = run(`suggestState[${JSON.stringify(KEY)}].items[0].text`);
  const event = dispatch(item, 'mousedown');
  assert.equal(event.defaultPrevented, true, 'mousedown keeps the textarea focused');
  assert.equal(ta.value, expected);
  assert.equal(run(`current.free[${JSON.stringify(KEY)}]`), expected);
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}]`), undefined,
    'accepting the pick dismisses the dropdown');
});

test('acceptSuggest ignores an index the list does not have', () => {
  const { run } = loadUi();
  seedState(run, { active: 0 });
  run(`__ta.value = 'keep'; current.free[${JSON.stringify(KEY)}] = 'keep';`);
  run(`acceptSuggest(${JSON.stringify(KEY)}, __ta, 99);`);
  assert.equal(run('__ta.value'), 'keep');
  assert.equal(run(`current.free[${JSON.stringify(KEY)}]`), 'keep');
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}].items.length`), ITEMS.length,
    'a stale index does not dismiss the dropdown');
});

test('suggestKeydown does nothing when that key has no suggestion list', () => {
  const { run } = loadUi();
  run(`current = blankForm();
       globalThis.__ta = { value: 'keep' };
       globalThis.__pd = false;`);
  run(`suggestKeydown({
         key: 'ArrowDown',
         preventDefault() { globalThis.__pd = true; },
       }, ${JSON.stringify(KEY)}, __ta);`);
  assert.equal(run('__pd'), false);
  assert.equal(run('__ta.value'), 'keep');
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}]`), undefined);
});

test('showSuggest interpolates suggestion text through escapeHtml', () => {
  const { run, created } = loadUi();
  const payload = '<img src=x onerror=alert(1)>';
  run(`forms = [blankForm()];
       forms[0].free[${JSON.stringify(KEY)}] = ${JSON.stringify(payload)};
       globalThis.__ta = {
         value: '',
         closest() { return { appendChild() {} }; },
       };
       showSuggest(${JSON.stringify(KEY)}, __ta);`);
  const box = created.find(c => c.el.className === 'suggest')?.el
    ?? created[created.length - 1]?.el;
  assert.ok(box, 'showSuggest creates a dropdown element');
  assert.match(box.innerHTML, /&lt;img/, 'suggestion text is escaped');
  assert.doesNotMatch(box.innerHTML, /<img/, 'raw <img must not land in the dropdown');
  assert.equal(run(`suggestState[${JSON.stringify(KEY)}].active`), -1);
});
