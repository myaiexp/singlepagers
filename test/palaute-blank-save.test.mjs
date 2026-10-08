// A fully blank form is not a response (finding #11960): saveForm refuses it,
// so it never increments the headcount or lands in the export.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts, dispatch } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';

function boot() {
  let alerts;
  const { sandbox, run, loadError } = loadPage(PALAUTE_PATH, {
    patch(s) { alerts = captureAlerts(s); },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  return { sandbox, run, alerts };
}

test('saveForm refuses a fully blank form and does not write it', () => {
  const { run, sandbox, alerts } = boot();
  run('saveForm()');
  assert.equal(run('forms.length'), 0);
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), null, 'nothing was written');
  assert.equal(run('JSON.stringify(current)'), run('JSON.stringify(blankForm())'));
  assert.ok(alerts.some(a => /Tyhjää lomaketta ei tallenneta/.test(a)));
});

test('whitespace-only fields are still a blank form', () => {
  const { run, alerts } = boot();
  run('current.name = "  "; current.phone = " \\n "; current.free.best = " \\t ";');
  run('current.free.improve = " "; current.free.topics = ""; current.free.open = "  ";');
  run('saveForm()');
  assert.equal(run('forms.length'), 0);
  assert.ok(alerts.some(a => /Tyhjää lomaketta ei tallenneta/.test(a)));
});

for (const fill of [
  'current.phone = "040"',
  'current.attendance = "thu"',
  'current.recommend = "kylla"',
  'current.ratings[0] = 4',
  'current.free.open = "hei"',
]) {
  test(`saveForm keeps a form that has only ${fill}`, () => {
    const { run } = boot();
    run(`${fill}; saveForm();`);
    assert.equal(run('forms.length'), 1, 'one filled field is a response');
  });
}

test('a second save after a real one does not store the blank entry it leaves behind', () => {
  const { run, alerts } = boot();
  run('current.free.best = "Hyva"; current.name = "A"; saveForm();');
  const before = alerts.length;
  run('saveForm()');
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].free.best'), 'Hyva');
  assert.equal(run('buildExportPayload().formCount'), 1);
  assert.equal(run('sheetSummary().rows[1][0]'), 'Vastauksia yhteensä: 1');
  assert.equal(run('sheetResponses().rows.length'), 2, 'header plus the one real row');
  assert.ok(alerts.slice(before).some(a => /Tyhjää lomaketta ei tallenneta/.test(a)));
});

test('saving an edit that was cleared to blank keeps the stored response', () => {
  const { run, alerts } = boot();
  run('current.free.best = "Hyva"; current.name = "A"; saveForm();');
  const id = run('forms[0].id');
  run(`editForm(${JSON.stringify(id)});`);
  run(`current.free.best = "  "; current.name = ""; current.phone = "";
       current.attendance = null; current.recommend = null;
       current.ratings = current.ratings.map(() => null);`);
  run('saveForm()');
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].id'), id);
  assert.equal(run('forms[0].free.best'), 'Hyva');
  assert.equal(run('forms[0].name'), 'A');
  assert.equal(run('editingId'), id, 'the edit stays open so the operator can fill or delete');
  assert.ok(alerts.some(a => /Tyhjää lomaketta ei tallenneta/.test(a)));
});

test('a second Ctrl+Enter does not save the blank form the first save leaves', () => {
  const { run, sandbox, alerts } = boot();
  const key = (init) => dispatch(sandbox.document, 'keydown', { key: 'Enter', ctrlKey: true, ...init });
  run('current.free.best = "Hyva"');
  key();
  assert.equal(run('forms.length'), 1);
  const again = key();
  assert.equal(again.defaultPrevented, true);
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].free.best'), 'Hyva');
  assert.equal(run('sheetSummary().rows[1][0]'), 'Vastauksia yhteensä: 1');
  assert.ok(alerts.some(a => /Tyhjää lomaketta ei tallenneta/.test(a)));
});
