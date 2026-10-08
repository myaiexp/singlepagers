// Operator event wiring (finding #10357): the document keydown fast-path, the
// bindEntry inputs/clicks, and the review buttons, fired through the listeners
// the page actually registered. stableElements({ descendants: true }) keeps the
// bound nodes reachable and records classList, so the entry/review `hidden`
// toggle is real here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, dispatch, listeners, stableElements } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

function boot() {
  const { run, sandbox, loadError } = loadPage(PALAUTE_PATH, {
    patch(sb) { stableElements(sb, { descendants: true }); },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  const doc = sandbox.document;
  // Markup starts with #review hidden; boot only renders the entry view.
  run('showEntry()');
  return {
    run,
    sandbox,
    doc,
    entry: doc.getElementById('entry'),
    review: doc.getElementById('review'),
    key: (k, init = {}) => dispatch(doc, 'keydown', { key: k, ...init }),
    focusOn: (tagName) => { doc.activeElement = tagName ? { tagName } : null; },
  };
}

const ratings = (run) => run('JSON.stringify(current.ratings)');
const NO_RATINGS = JSON.stringify(Array(7).fill(null));

// --- Document keydown -----------------------------------------------------------

test('the page registers one document keydown listener', () => {
  const { doc } = boot();
  assert.equal(listeners(doc, 'keydown').length, 1);
});

test('Ctrl+Enter and Cmd+Enter save on the entry view', () => {
  const { run, key } = boot();
  const ev = key('Enter', { ctrlKey: true });
  assert.equal(run('forms.length'), 1);
  assert.equal(ev.defaultPrevented, true);
  key('Enter', { metaKey: true });
  assert.equal(run('forms.length'), 2);
});

// Holding Ctrl+Enter auto-repeats. Each repeat used to save another form
// (finding #11960). A separate press still saves; whether a blank one should
// count is a product call and is not decided here.
test('a repeating Ctrl+Enter does not save another form', () => {
  const { run, key } = boot();
  run('current.free.best = "Hyva"');
  key('Enter', { ctrlKey: true });
  assert.equal(run('forms.length'), 1);
  const repeat = key('Enter', { ctrlKey: true, repeat: true });
  assert.equal(repeat.defaultPrevented, true, 'the repeat is still swallowed');
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].free.best'), 'Hyva');
});

test('plain Enter does not save', () => {
  const { run, key } = boot();
  const ev = key('Enter');
  assert.equal(run('forms.length'), 0);
  assert.equal(ev.defaultPrevented, false);
});

test('Ctrl+Enter still saves while a raffle field has focus', () => {
  const { run, key, focusOn } = boot();
  focusOn('INPUT');
  key('Enter', { ctrlKey: true });
  assert.equal(run('forms.length'), 1);
});

test('Ctrl+Enter on the review view does not save', () => {
  const { run, key } = boot();
  run('showReview()');
  key('Enter', { ctrlKey: true });
  assert.equal(run('forms.length'), 0);
});

test('a digit with no text field focused routes through the cursor', () => {
  const { run, key } = boot();
  run('cursor = { section: "attendance" }');
  const ev = key('1');
  assert.equal(run('current.attendance'), run('ATTENDANCE[0].value'));
  assert.equal(run('cursor.section'), 'rating');
  assert.equal(run('cursor.row'), 0);
  assert.equal(ev.defaultPrevented, true);
  key('4');
  assert.equal(run('current.ratings[0]'), 4);
});

for (const tagName of ['INPUT', 'TEXTAREA']) {
  test(`digits typed into a focused ${tagName} leave ratings and cursor alone`, () => {
    const { run, key, focusOn } = boot();
    run('cursor = { section: "rating", row: 0 }');
    focusOn(tagName);
    for (const ch of '0401234555') {
      assert.equal(key(ch).defaultPrevented, false, `key ${ch} must reach the field`);
    }
    assert.equal(ratings(run), NO_RATINGS);
    assert.equal(run('JSON.stringify(cursor)'), '{"section":"rating","row":0}');
  });
}

test('digits on the review view do not move the cursor', () => {
  const { run, key } = boot();
  run('showReview(); cursor = { section: "attendance" };');
  const ev = key('1');
  assert.equal(run('current.attendance'), null);
  assert.equal(run('cursor.section'), 'attendance');
  assert.equal(ev.defaultPrevented, false);
});

test('keys outside 0-5 are not routed', () => {
  const { run, key } = boot();
  run('cursor = { section: "rating", row: 0 }');
  for (const k of ['6', '9', 'a', 'Tab']) assert.equal(key(k).defaultPrevented, false);
  assert.equal(ratings(run), NO_RATINGS);
});

// --- bindEntry inputs and clicks --------------------------------------------------

test('typing into the raffle fields lands in the saved form', () => {
  const { run, entry, key } = boot();
  const name = entry.querySelector('#r-name');
  const phone = entry.querySelector('#r-phone');
  name.value = 'Maija Meikäläinen';
  dispatch(name, 'input');
  phone.value = '0401234567';
  dispatch(phone, 'input');
  assert.equal(run('current.name'), 'Maija Meikäläinen');
  assert.equal(run('current.phone'), '0401234567');
  key('Enter', { ctrlKey: true });
  assert.equal(run('forms[0].name'), 'Maija Meikäläinen');
  assert.equal(run('forms[0].phone'), '0401234567');
});

test('a free-text field writes current.free on input and releases the cursor on focus', () => {
  const { run, entry } = boot();
  const k = run('FREETEXT[0].key');
  const ta = entry.querySelector(`#ft-${k}`);
  run('cursor = { section: "attendance" }');
  dispatch(ta, 'focus');
  assert.equal(run('cursor'), null);
  ta.value = 'Hyvät puhujat';
  dispatch(ta, 'input');
  assert.equal(run(`current.free[${JSON.stringify(k)}]`), 'Hyvät puhujat');
});

test('a free-text field forwards keydown to its suggestions and closes them on blur', () => {
  const { run, sandbox, entry } = boot();
  run('current.free.best = "musiikki"; saveForm();'); // one earlier answer to suggest
  const ta = () => entry.querySelector('#ft-best');
  ta().value = 'musi';
  dispatch(ta(), 'input');
  assert.equal(run('suggestState.best.items[0].text'), 'musiikki');
  const down = dispatch(ta(), 'keydown', { key: 'ArrowDown' });
  assert.equal(down.defaultPrevented, true);
  assert.equal(run('suggestState.best.active'), 0);
  dispatch(ta(), 'keydown', { key: 'Enter' });
  assert.equal(run('current.free.best'), 'musiikki');

  dispatch(ta(), 'input');
  assert.ok(run('suggestState.best'), 'input reopens the suggestions');
  sandbox.setTimeout = (fn) => { fn(); return 0; }; // run the 150 ms blur delay now
  dispatch(ta(), 'blur');
  assert.equal(run('suggestState.best'), undefined);
});

test('attendance, rating and recommend buttons pick through their onclick', () => {
  const { run, entry } = boot();
  const att = entry.querySelectorAll('.att')[1];
  att.dataset.value = run('ATTENDANCE[1].value');
  att.onclick();
  assert.equal(run('current.attendance'), run('ATTENDANCE[1].value'));

  const cell = entry.querySelectorAll('.gcell[data-row]')[0];
  Object.assign(cell.dataset, { row: '2', val: '4' });
  cell.onclick();
  assert.equal(run('current.ratings[2]'), 4);
  assert.equal(run('cursor.row'), 3);

  const rec = entry.querySelectorAll('.rec')[0];
  rec.dataset.value = run('RECOMMEND[0].value');
  rec.onclick();
  assert.equal(run('current.recommend'), run('RECOMMEND[0].value'));
});

test('the save button is wired to saveForm', () => {
  const { run, entry } = boot();
  const save = entry.querySelector('#saveBtn');
  assert.equal(save.onclick, run('saveForm'));
  save.onclick();
  assert.equal(run('forms.length'), 1);
});

// --- Review view ------------------------------------------------------------------

function bootWithSavedForm() {
  const page = boot();
  page.run('current.name = "Liisa"; saveForm(); showReview();');
  return { ...page, id: page.run('forms[0].id') };
}

test('the Tarkastele button toggles between entry and review', () => {
  const { run, doc, entry, review } = boot();
  const btn = doc.getElementById('reviewBtn');
  btn.onclick();
  assert.equal(review.classList.contains('hidden'), false);
  assert.equal(entry.classList.contains('hidden'), true);
  assert.equal(btn.textContent, 'Takaisin syöttöön');
  btn.onclick();
  assert.equal(entry.classList.contains('hidden'), false);
  assert.equal(review.classList.contains('hidden'), true);
  assert.equal(run('reviewBtn.textContent'), 'Tarkastele');
});

test('Muokkaa opens the form for editing and Peruuta returns to review', () => {
  const { run, entry, review, id } = bootWithSavedForm();
  const edit = review.querySelectorAll('[data-edit]')[0];
  edit.dataset.edit = id;
  edit.onclick();
  assert.equal(run('editingId'), id);
  assert.equal(run('current.name'), 'Liisa');
  assert.equal(entry.classList.contains('hidden'), false);

  entry.querySelector('#cancelBtn').onclick();
  assert.equal(run('editingId'), null);
  assert.equal(review.classList.contains('hidden'), false);
  assert.equal(run('forms.length'), 1);
});

test('Poista deletes only after confirm', () => {
  const { run, sandbox, review, id } = bootWithSavedForm();
  const del = () => {
    const b = review.querySelectorAll('[data-del]')[0];
    b.dataset.del = id;
    b.onclick();
  };
  del(); // stub confirm() answers false
  assert.equal(run('forms.length'), 1);
  sandbox.confirm = () => true;
  del();
  assert.equal(run('forms.length'), 0);
});

test('Tyhjennä kaikki clears every form after confirm', () => {
  const { run, sandbox, review } = bootWithSavedForm();
  sandbox.confirm = () => true;
  review.querySelector('#clearBtn').onclick();
  assert.equal(run('forms.length'), 0);
});
