// Refused storage on read and on clearAll (finding #12349). persist()'s
// setItem catch is tested in palaute-save; these two paths were not. A boot
// with storage missing must not throw, and the post-event wipe must finish
// in memory when removeItem throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';

function refuse() {
  const err = new Error('storage blocked');
  err.name = 'SecurityError';
  throw err;
}

// mode: 'null' (localStorage is null) or 'throwing' (get/set/remove throw).
function bootBlocked(mode) {
  let alerts;
  const { sandbox, run, loadError } = loadPage(PALAUTE_PATH, {
    patch(sb) {
      alerts = captureAlerts(sb);
      sb.confirm = () => true;
      if (mode === 'null') {
        sb.localStorage = null;
      } else {
        sb.localStorage.getItem = refuse;
        sb.localStorage.setItem = refuse;
        sb.localStorage.removeItem = refuse;
      }
    },
  });
  return { sandbox, run, loadError, alerts };
}

for (const mode of ['null', 'throwing']) {
  test(`booting with storage ${mode} leaves an empty in-memory list`, () => {
    const { run, loadError } = bootBlocked(mode);
    assert.equal(loadError, undefined, loadError && loadError.stack);
    assert.equal(run('forms.length'), 0);
    assert.equal(run('storageUnreadable'), false);
  });

  test(`saveForm with storage ${mode} keeps the form in memory and alerts`, () => {
    const { run, alerts } = bootBlocked(mode);
    run('current.attendance = "both"; current.free.best = "Hyva";');
    assert.doesNotThrow(() => run('saveForm()'));
    assert.equal(run('forms.length'), 1);
    assert.equal(run('forms[0].attendance'), 'both');
    assert.equal(run('forms[0].free.best'), 'Hyva');
    assert.ok(run('forms[0].id'), 'the in-memory row still gets an id');
    assert.ok(
      alerts.some((a) => /täynnä/.test(a) && /Vie/.test(a)),
      'the operator is told the write did not reach disk',
    );
  });
}

test('clearAll with a throwing removeItem finishes the in-memory wipe and alerts', () => {
  const { run, alerts, sandbox } = bootBlocked('throwing');
  run('current.name = "Liisa"; saveForm();');
  assert.equal(run('forms.length'), 1);
  const before = alerts.length;

  assert.doesNotThrow(() => run('clearAll()'));

  assert.equal(run('forms.length'), 0);
  assert.equal(run('storageUnreadable'), false);
  assert.equal(run('editingId'), null);
  assert.ok(alerts.length > before, 'persist reports the refused write');
  assert.ok(alerts.some((a) => /täynnä/.test(a)));
  // The keys could not be removed. The wipe is the in-memory list, not a
  // pretend success at deleting a store that throws.
  assert.throws(() => sandbox.localStorage.removeItem(STORAGE_KEY));
});
