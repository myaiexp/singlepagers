// Attendance / recommend pick flow (finding #9594): mouse (bindEntry) and
// keyboard (routeNumberKey) must share one hand-off. The entry element here
// counts innerHTML rewrites, so a focus() that lands on a textarea from an
// earlier render — detached by renderEntry, focus drops to <body> in a real
// browser — is caught on both paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

// Boot palaute with #entry replaced by a recorder: each innerHTML write starts a
// new render generation; every child it hands out remembers its generation, and
// every querySelectorAll list is kept by selector so tests can fire an onclick.
function bootWithEntryRecorder() {
  const rec = { gen: 0, focused: [], lists: {} };
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) {
      const doc = sandbox.document;
      const base = doc.createElement('div');
      const entry = new Proxy({}, {
        get(t, p) {
          if (p === 'querySelector') {
            return (sel) => {
              const child = doc.createElement('x');
              const gen = rec.gen;
              child.focus = () => rec.focused.push({ sel, gen });
              return child;
            };
          }
          if (p === 'querySelectorAll') {
            return (sel) => {
              const list = base.querySelectorAll(sel);
              (rec.lists[sel] ||= []).push(list);
              return list;
            };
          }
          return p in t ? t[p] : base[p];
        },
        set(t, p, v) {
          if (p === 'innerHTML') rec.gen++;
          t[p] = v;
          return true;
        },
      });
      const orig = doc.getElementById;
      doc.getElementById = (id) => (id === 'entry' ? entry : orig(id));
    },
  });
  run('current = blankForm(); cursor = { section: "attendance" }; renderEntry();');
  return { run, rec };
}

function lastFocus(rec) {
  return rec.focused[rec.focused.length - 1];
}

// First button bindEntry wired for `sel`. refreshCursor also queries ".att"
// (to outline it), and the stub answers any unset member with a no-op factory,
// so only an own `onclick` marks the list bindEntry bound.
function boundButton(rec, sel) {
  const lists = rec.lists[sel] || [];
  const list = [...lists].reverse().find(l => 'onclick' in l[0]);
  assert.ok(list, `bindEntry binds onclick on ${sel}`);
  return list[0];
}

test('keyboard recommend focuses the first textarea of the render it leaves behind', () => {
  const { run, rec } = bootWithEntryRecorder();
  run('cursor = { section: "recommend" }; routeNumberKey(1);');
  assert.equal(run('current.recommend'), 'kylla');
  assert.equal(run('cursor'), null, 'recommend releases the cursor to free text');
  const f = lastFocus(rec);
  assert.ok(f, 'a textarea is focused');
  assert.equal(f.sel, '#ft-best');
  assert.equal(f.gen, rec.gen, 'focus must hit the live textarea, not one renderEntry replaced');
});

test('clicking a recommend button takes the same hand-off as the keyboard', () => {
  const { run, rec } = bootWithEntryRecorder();
  const btn = boundButton(rec, '.rec');
  btn.dataset.value = 'ehka';
  btn.onclick();
  assert.equal(run('current.recommend'), 'ehka');
  assert.equal(run('cursor'), null);
  const f = lastFocus(rec);
  assert.ok(f, 'a textarea is focused');
  assert.equal(f.sel, '#ft-best');
  assert.equal(f.gen, rec.gen, 'focus must hit the live textarea, not one renderEntry replaced');
});

test('clicking an attendance button moves the cursor to rating row 0 and re-renders', () => {
  const { run, rec } = bootWithEntryRecorder();
  const before = rec.gen;
  const btn = boundButton(rec, '.att');
  btn.dataset.value = 'thu';
  btn.onclick();
  assert.equal(run('current.attendance'), 'thu');
  assert.equal(run('cursor.section'), 'rating');
  assert.equal(run('cursor.row'), 0);
  assert.ok(rec.gen > before, 'the pick re-renders the entry view');
});
