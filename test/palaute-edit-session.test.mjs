// Edit-session reconciliation (finding #10532): review-view actions taken
// mid-edit (delete, clearAll, Muokkaa on another row) must not strand
// editingId or silently discard the operator's typed form.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

function bootPalaute() {
  let alerts;
  const confirms = [];
  const confirmCtl = { value: true };
  const { run } = loadPage(PALAUTE_PATH, {
    patch(s) {
      alerts = captureAlerts(s);
      s.confirm = (msg) => { confirms.push(msg); return confirmCtl.value; };
    },
  });
  return { run, alerts, confirms, confirmCtl };
}

// Two saved forms A and B; returns their ids.
function seedTwo(run) {
  run('current.attendance = "both"; current.free.best = "A"; saveForm();');
  run('current.attendance = "thu"; current.free.best = "B"; saveForm();');
  return [run('forms[0].id'), run('forms[1].id')];
}

test('deleting the form under edit ends the edit session', () => {
  const { run } = bootPalaute();
  const [a] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)}); current.free.best = "typed";`);
  run('showReview()');
  run(`deleteForm(${JSON.stringify(a)})`);

  assert.equal(run('editingId'), null);
  assert.equal(run('JSON.stringify(current)'), run('JSON.stringify(blankForm())'));
  run('showEntry()');
  assert.doesNotMatch(run('entryEl.innerHTML'), /Muokataan lomaketta #0/);
});

test('deleting a different row keeps the edit session', () => {
  const { run } = bootPalaute();
  const [a, b] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)}); current.free.best = "typed";`);
  run(`deleteForm(${JSON.stringify(b)})`);

  assert.equal(run('editingId'), a);
  assert.equal(run('current.free.best'), 'typed');
});

test('clearAll mid-edit ends the edit session and blanks current', () => {
  const { run } = bootPalaute();
  const [a] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)}); current.free.best = "typed";`);
  run('clearAll()');

  assert.equal(run('editingId'), null);
  assert.equal(run('JSON.stringify(current)'), run('JSON.stringify(blankForm())'));
});

test('clearAll also wipes a half-entered new form (it may hold raffle contacts)', () => {
  const { run } = bootPalaute();
  seedTwo(run);
  run('current.name = "Matti"; current.phone = "040";');
  run('clearAll()');
  assert.equal(run('JSON.stringify(current)'), run('JSON.stringify(blankForm())'));
});

test('saveForm on an edit whose row vanished keeps the work as a new row and tells the operator', () => {
  const { run, alerts } = bootPalaute();
  const [a] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)}); current.free.best = "typed";`);
  // Bypass deleteForm's reconciliation to reach saveForm's defensive branch.
  run(`forms = forms.filter(f => f.id !== ${JSON.stringify(a)});`);
  run('saveForm()');

  assert.equal(run('forms.length'), 2);
  assert.equal(run('forms[1].free.best'), 'typed');
  assert.equal(run('editingId'), null);
  assert.ok(alerts.some(m => /poistettu/i.test(m)), 'operator is told the row was gone');
});

test('Muokkaa over a half-entered new form asks first; declining keeps it', () => {
  const { run, confirms, confirmCtl } = bootPalaute();
  const [, b] = seedTwo(run);
  run('current.free.best = "half typed";');
  confirmCtl.value = false;
  run(`editForm(${JSON.stringify(b)})`);

  assert.equal(confirms.length, 1);
  assert.equal(run('editingId'), null);
  assert.equal(run('current.free.best'), 'half typed');

  confirmCtl.value = true;
  run(`editForm(${JSON.stringify(b)})`);
  assert.equal(run('editingId'), b);
  assert.equal(run('current.free.best'), 'B');
});

test('Muokkaa on row B while A has unsaved edits asks first', () => {
  const { run, confirms, confirmCtl } = bootPalaute();
  const [a, b] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)}); current.free.best = "edited A";`);
  confirmCtl.value = false;
  run(`editForm(${JSON.stringify(b)})`);

  assert.equal(confirms.length, 1);
  assert.equal(run('editingId'), a);
  assert.equal(run('current.free.best'), 'edited A');
});

test('Muokkaa with no unsaved changes does not prompt', () => {
  const { run, confirms } = bootPalaute();
  const [a, b] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)})`);
  run(`editForm(${JSON.stringify(b)})`);
  assert.equal(confirms.length, 0);
  assert.equal(run('editingId'), b);
});

test('Muokkaa on the row already under edit returns to it without discarding edits', () => {
  const { run, confirms } = bootPalaute();
  const [a] = seedTwo(run);
  run(`editForm(${JSON.stringify(a)}); current.free.best = "edited A";`);
  run('showReview()');
  run(`editForm(${JSON.stringify(a)})`);

  assert.equal(confirms.length, 0);
  assert.equal(run('current.free.best'), 'edited A');
  assert.equal(run('reviewBtn.textContent'), 'Tarkastele', 'entry view is showing');
});
