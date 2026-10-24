// Sibling blobs (finding #12571): a deleted-list or a forms recovery copy that
// fails to parse is the only record of those bytes. persist() must not replace
// it with the empty read. A damaged deleted-list diverts to its own recovery
// key so a delete still suppresses the row, including raffle name and phone.
// If the forms recovery copy itself fails to parse, new rows stay in memory.
// Both deleted-lists damaged: palaute-tombstone-blocked.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';
const RECOVERY_KEY = STORAGE_KEY + '_recovery';
const DELETED_KEY = STORAGE_KEY + '_deleted';
const DELETED_RECOVERY_KEY = DELETED_KEY + '_recovery';

function form(id, best, extra = {}) {
  return {
    id,
    attendance: null,
    ratings: [null, null, null, null, null, null, null],
    recommend: null,
    free: { best, improve: '', topics: '', open: '' },
    name: '',
    phone: '',
    ...extra,
  };
}

function boot(seed = {}) {
  let alerts;
  const { sandbox, run, loadError } = loadPage(PALAUTE_PATH, {
    seed,
    patch(s) {
      alerts = captureAlerts(s);
      s.confirm = () => true;
    },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  return { sandbox, run, alerts };
}

function stored(sandbox, key = STORAGE_KEY) {
  const raw = sandbox.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function idsOf(list) {
  return (list || []).map(f => f.id);
}

test('a save leaves a corrupt deleted-list in place and does not invent an empty copy', () => {
  const tombstone = '["row-deleted"';
  const { sandbox, run, alerts } = boot({
    [STORAGE_KEY]: JSON.stringify([form('row-kept', 'stay')]),
    [DELETED_KEY]: tombstone,
  });
  run('current.attendance = "both"; saveForm();');
  assert.equal(sandbox.localStorage.getItem(DELETED_KEY), tombstone,
    'persist must not overwrite a tombstone that failed to parse');
  assert.equal(sandbox.localStorage.getItem(DELETED_RECOVERY_KEY), null,
    'an empty delete set must not create a diverted list');
  assert.ok(alerts.some(a => /Poistolistaa ei voitu lukea/.test(a)));
  assert.equal(alerts.filter(a => /Poistolistaa ei voitu lukea/.test(a)).length, 1,
    'the warning is once per load, not again on save');
});

for (const tombstone of ['{}', 'null', '42', '"text"']) {
  test(`a non-array deleted-list ${tombstone} is left in place`, () => {
    const { sandbox, run } = boot({
      [STORAGE_KEY]: JSON.stringify([form('row-kept', 'stay')]),
      [DELETED_KEY]: tombstone,
    });
    run('current.attendance = "fri"; saveForm();');
    assert.equal(sandbox.localStorage.getItem(DELETED_KEY), tombstone);
  });
}

test('a delete beside a corrupt tombstone sticks for a tab that still has the row', () => {
  const tombstone = '{"not":"a list"}';
  const row = form('row-1', 'one', { name: 'Liisa', phone: '040123' });
  const first = boot({
    [STORAGE_KEY]: JSON.stringify([row]),
    [DELETED_KEY]: tombstone,
  });
  first.run('deleteForm("row-1")');
  assert.equal(first.sandbox.localStorage.getItem(DELETED_KEY), tombstone);
  const diverted = JSON.parse(first.sandbox.localStorage.getItem(DELETED_RECOVERY_KEY));
  assert.ok(diverted.includes('row-1'));
  assert.deepEqual(idsOf(stored(first.sandbox)), []);
  assert.equal(JSON.stringify(stored(first.sandbox)).includes('Liisa'), false);

  const second = boot({
    [STORAGE_KEY]: first.sandbox.localStorage.getItem(STORAGE_KEY),
    [DELETED_KEY]: tombstone,
    [DELETED_RECOVERY_KEY]: first.sandbox.localStorage.getItem(DELETED_RECOVERY_KEY),
  });
  second.run(`forms.push(${JSON.stringify(row)}); persist();`);
  assert.equal(second.sandbox.localStorage.getItem(DELETED_KEY), tombstone);
  assert.deepEqual(idsOf(stored(second.sandbox)), [],
    'the diverted tombstone keeps the delete, so the raffle contact stays gone');
  assert.equal(JSON.stringify(stored(second.sandbox) || []).includes('040123'), false);
});

test('clearAll records the wipe beside a corrupt tombstone instead of replacing it', () => {
  const tombstone = '["row-1"';
  const { sandbox, run } = boot({
    [STORAGE_KEY]: JSON.stringify([form('row-1', 'one', { name: 'Liisa', phone: '040' })]),
    [DELETED_KEY]: tombstone,
  });
  run('clearAll()');
  assert.equal(sandbox.localStorage.getItem(DELETED_KEY), tombstone);
  const diverted = JSON.parse(sandbox.localStorage.getItem(DELETED_RECOVERY_KEY));
  assert.ok(diverted.includes('row-1'));
  assert.deepEqual(idsOf(stored(sandbox)), []);
});

test('a corrupt forms recovery copy is left in place and new rows stay in memory', () => {
  const canonical = '{not-json';
  const recovery = '{"rows":';
  const { sandbox, run, alerts } = boot({
    [STORAGE_KEY]: canonical,
    [RECOVERY_KEY]: recovery,
  });
  run('current.attendance = "both"; current.name = "A"; current.phone = "111"; saveForm();');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), canonical);
  assert.equal(sandbox.localStorage.getItem(RECOVERY_KEY), recovery,
    'persist must not replace the unreadable recovery copy');
  assert.equal(run('forms.length'), 1, 'the row stays in memory for export');
  assert.equal(run('forms[0].phone'), '111');
  assert.ok(alerts.some(a => /palautuskopio ovat vioittuneet/.test(a) && /vain muistissa/.test(a)));
  assert.equal(alerts.some(a => /tallennetaan erilliseen palautuskopioon/.test(a)), false,
    'must not promise a recovery write when that copy is unreadable');
  const warnings = alerts.length;
  run('current.attendance = "fri"; saveForm();');
  assert.equal(alerts.length, warnings, 'the recovery warning is once');
  assert.equal(sandbox.localStorage.getItem(RECOVERY_KEY), recovery);
  assert.equal(run('forms.length'), 2);
});

test('a non-array forms recovery copy is left in place', () => {
  const recovery = '{}';
  const { sandbox, run } = boot({
    [STORAGE_KEY]: '{not-json',
    [RECOVERY_KEY]: recovery,
  });
  run('current.attendance = "thu"; saveForm();');
  assert.equal(sandbox.localStorage.getItem(RECOVERY_KEY), recovery);
  assert.equal(run('forms.length'), 1);
});

test('persist does not overwrite a canonical blob that turns corrupt after load', () => {
  const row = form('row-1', 'one');
  const { sandbox, run } = boot({ [STORAGE_KEY]: JSON.stringify([row]) });
  const damaged = '{broke';
  sandbox.localStorage.setItem(STORAGE_KEY, damaged);
  run('current.attendance = "thu"; saveForm();');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), damaged);
  const ids = idsOf(stored(sandbox, RECOVERY_KEY));
  assert.ok(ids.includes('row-1'));
  assert.equal(ids.length, 2, 'this tab\'s rows divert to the recovery key');
});
