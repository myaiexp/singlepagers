// Attendance / recommend pick flow (finding #9594): mouse (bindEntry) and
// keyboard (routeNumberKey) must share one hand-off. #entry's descendants are
// stable only until its innerHTML is rewritten, so a focus() that lands on a
// textarea from an earlier render — detached by renderEntry, focus drops to
// <body> in a real browser — leaves the live textarea unfocused on both paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

function bootEntry() {
  let byId;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) { byId = stableElements(sandbox, { descendants: true }); },
  });
  run('current = blankForm(); cursor = { section: "attendance" }; renderEntry();');
  return { run, entry: byId.get('entry') };
}

// The textarea the current render holds: a node from an earlier render is not
// what this query returns, so its `focused` is the live one's.
function liveTextarea(entry) {
  return entry.querySelector('#ft-best');
}

// First button of `sel` in the current render, which bindEntry must have wired.
function boundButton(entry, sel) {
  const btn = entry.querySelectorAll(sel)[0];
  assert.ok('onclick' in btn, `bindEntry binds onclick on ${sel}`);
  return btn;
}

test('keyboard recommend focuses the first textarea of the render it leaves behind', () => {
  const { run, entry } = bootEntry();
  run('cursor = { section: "recommend" }; routeNumberKey(1);');
  assert.equal(run('current.recommend'), 'kylla');
  assert.equal(run('cursor'), null, 'recommend releases the cursor to free text');
  assert.equal(liveTextarea(entry).focused, true,
    'focus must hit the live #ft-best, not one renderEntry replaced');
});

test('clicking a recommend button takes the same hand-off as the keyboard', () => {
  const { run, entry } = bootEntry();
  const btn = boundButton(entry, '.rec');
  btn.dataset.value = 'ehka';
  btn.onclick();
  assert.equal(run('current.recommend'), 'ehka');
  assert.equal(run('cursor'), null);
  assert.equal(liveTextarea(entry).focused, true,
    'focus must hit the live #ft-best, not one renderEntry replaced');
});

test('clicking an attendance button moves the cursor to rating row 0 and re-renders', () => {
  const { run, entry } = bootEntry();
  const before = entry.querySelectorAll('.att');
  const btn = boundButton(entry, '.att');
  btn.dataset.value = 'thu';
  btn.onclick();
  assert.equal(run('current.attendance'), 'thu');
  assert.equal(run('cursor.section'), 'rating');
  assert.equal(run('cursor.row'), 0);
  assert.notEqual(entry.querySelectorAll('.att'), before, 'the pick re-renders the entry view');
});
