// Blocked tombstones (idea #6711): when the deleted-list and its _recovery copy
// both fail to parse, no delete can be recorded. A row removed from the store
// without a tombstone comes back from the other tab's next save, raffle name
// and phone included, so a row leaves the store only with a written tombstone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';
const DELETED_KEY = STORAGE_KEY + '_deleted';
const DELETED_RECOVERY_KEY = DELETED_KEY + '_recovery';
const TOMBSTONE = '["row-1"';
const COPY = '["row-9"';

function form(id, best, extra = {}) {
  return {
    id,
    attendance: 'both',
    ratings: [null, null, null, null, null, null, null],
    recommend: null,
    free: { best, improve: '', topics: '', open: '' },
    name: '',
    phone: '',
    ...extra,
  };
}

const ROW = form('row-1', 'one', { name: 'Liisa', phone: '040123' });

function boot(seed = {}) {
  let alerts;
  const confirms = [];
  const { sandbox, run, loadError } = loadPage(PALAUTE_PATH, {
    seed,
    patch(s) {
      alerts = captureAlerts(s);
      s.confirm = (msg) => { confirms.push(msg); return true; };
    },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  return { sandbox, run, alerts, confirms };
}

function storedIds(sandbox) {
  const raw = sandbox.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw).map(f => f.id) : [];
}

function blockedSeed() {
  return {
    [STORAGE_KEY]: JSON.stringify([ROW]),
    [DELETED_KEY]: TOMBSTONE,
    [DELETED_RECOVERY_KEY]: COPY,
  };
}

test('the load warning says single deletes are blocked, not kept in memory', () => {
  const { alerts } = boot(blockedSeed());
  const warning = alerts.find(a => /Poistolistaa eikä sen palautuskopiota voitu lukea/.test(a));
  assert.ok(warning, alerts.join('\n---\n'));
  assert.match(warning, /poisto on estetty/);
  assert.equal(alerts.some(a => /pysyvät vain muistissa/.test(a)), false);
  assert.equal(alerts.some(a => /Uudet poistot tallennetaan/.test(a)), false,
    'must not promise a diverted write that cannot happen');
});

test('a delete that cannot be tombstoned is refused before the confirm', () => {
  const { sandbox, run, alerts, confirms } = boot(blockedSeed());
  const before = alerts.length;
  run('deleteForm("row-1")');
  assert.equal(confirms.length, 0, 'no confirm for a delete that will not happen');
  assert.equal(alerts.length, before + 1);
  assert.match(alerts.at(-1), /Lomaketta ei voi poistaa/);
  assert.equal(run('forms.length'), 1, 'the row stays visible and exportable');
  assert.deepEqual(storedIds(sandbox), ['row-1']);
  assert.equal(sandbox.localStorage.getItem(DELETED_KEY), TOMBSTONE);
  assert.equal(sandbox.localStorage.getItem(DELETED_RECOVERY_KEY), COPY);
});

test('a save keeps a deleted row on disk once its tombstone became unwritable', () => {
  const row2 = form('row-2', 'two');
  const { sandbox, run } = boot({ [STORAGE_KEY]: JSON.stringify([ROW, row2]) });
  run('deleteForm("row-1")');
  assert.deepEqual(storedIds(sandbox), ['row-2']);
  // Both lists break, then the other tab (no readable tombstone) writes row-1 back.
  sandbox.localStorage.setItem(DELETED_KEY, TOMBSTONE);
  sandbox.localStorage.setItem(DELETED_RECOVERY_KEY, COPY);
  sandbox.localStorage.setItem(STORAGE_KEY, JSON.stringify([row2, ROW]));
  run('current.attendance = "fri"; saveForm();');
  const ids = storedIds(sandbox);
  assert.ok(ids.includes('row-1'),
    'stripping it again with no tombstone only makes the two tabs oscillate');
  assert.equal(ids.length, 3);
  assert.equal(run('forms.some(f => f.id === "row-1")'), false,
    'this tab still hides the row it deleted');
  assert.equal(sandbox.localStorage.getItem(DELETED_KEY), TOMBSTONE);
  assert.equal(sandbox.localStorage.getItem(DELETED_RECOVERY_KEY), COPY);
});

test('clearAll discards the damaged copy so the wipe is tombstoned', () => {
  const first = boot(blockedSeed());
  first.run('clearAll()');
  assert.deepEqual(storedIds(first.sandbox), []);
  assert.equal(first.sandbox.localStorage.getItem(DELETED_KEY), TOMBSTONE,
    'the damaged primary list stays for a hand repair');
  const copy = JSON.parse(first.sandbox.localStorage.getItem(DELETED_RECOVERY_KEY));
  assert.ok(copy.includes('row-1'));

  // The other tab still holds the row in memory; its save must not restore it.
  const second = boot({
    [STORAGE_KEY]: first.sandbox.localStorage.getItem(STORAGE_KEY),
    [DELETED_KEY]: TOMBSTONE,
    [DELETED_RECOVERY_KEY]: first.sandbox.localStorage.getItem(DELETED_RECOVERY_KEY),
  });
  second.run(`forms.push(${JSON.stringify(ROW)}); baseJson = snapshotForms(forms); persist();`);
  assert.deepEqual(storedIds(second.sandbox), []);
  assert.equal(second.sandbox.localStorage.getItem(STORAGE_KEY).includes('040123'), false);
});

test('a damaged copy beside a readable list warns about its unreadable deletes only', () => {
  const { run, alerts, confirms } = boot({
    [STORAGE_KEY]: JSON.stringify([ROW]),
    [DELETED_RECOVERY_KEY]: COPY,
  });
  const warning = alerts.find(a => /Poistolistan palautuskopiota ei voitu lukea/.test(a));
  assert.ok(warning);
  assert.equal(/pysyvät vain muistissa/.test(warning), false);
  run('deleteForm("row-1")');
  assert.equal(confirms.length, 1, 'the readable primary list can record the delete');
  assert.equal(run('forms.length'), 0);
});
