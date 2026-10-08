// Two open tabs share one store (findings #11959, #11971). A save, delete or
// clear merges by id and honors explicit deletes, so one tab cannot drop or
// resurrect the other's responses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';
const RECOVERY_KEY = STORAGE_KEY + '_recovery';
const DELETED_KEY = STORAGE_KEY + '_deleted';

function form(id, best) {
  return {
    id,
    attendance: null,
    ratings: [null, null, null, null, null, null, null],
    recommend: null,
    free: { best, improve: '', topics: '', open: '' },
    name: '',
    phone: '',
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

function put(sandbox, forms, key = STORAGE_KEY) {
  sandbox.localStorage.setItem(key, JSON.stringify(forms));
}

function stored(sandbox, key = STORAGE_KEY) {
  const raw = sandbox.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function idsOf(list) {
  return (list || []).map(f => f.id);
}

test('a save keeps a response another tab wrote after this tab booted', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  const row2 = form('row-2', 'two');
  put(sandbox, [row1, row2]);
  run('current.attendance = "both"; saveForm();');
  const ids = idsOf(stored(sandbox));
  assert.ok(ids.includes('row-1') && ids.includes('row-2'));
  assert.equal(ids.length, 3, 'this tab\'s new row is there too');
  assert.equal(alerts.length, 0, 'picking up the other tab\'s row is not an error');
});

test('an unchanged row does not overwrite the other tab\'s edit of it', () => {
  const row1 = form('row-1', 'old');
  const { sandbox, run } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  const edited = stored(sandbox);
  edited[0].free.best = 'newer';
  put(sandbox, edited);
  run('current.phone = "040"; saveForm();');
  const disk = stored(sandbox);
  assert.equal(disk.find(f => f.id === 'row-1').free.best, 'newer');
  assert.equal(disk.length, 2);
});

test('when both tabs edited one id, both versions survive', () => {
  const row1 = form('row-1', 'old');
  const { sandbox, run, alerts } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  run('editForm("row-1"); current.free.best = "ours";');
  const edited = stored(sandbox);
  edited[0].free.best = 'theirs';
  put(sandbox, edited);
  run('saveForm()');
  const disk = stored(sandbox);
  const bests = disk.map(f => f.free.best).sort();
  assert.deepEqual(bests, ['ours', 'theirs']);
  assert.equal(disk.find(f => f.id === 'row-1').free.best, 'ours');
  assert.equal(disk.filter(f => f.id === 'row-1').length, 1);
  assert.ok(alerts.some(a => /Molemmat versiot/.test(a)));
});

test('deleteForm drops that id and still keeps a row only the other tab has', () => {
  const rows = [form('row-1', 'one'), form('row-2', 'two')];
  const { sandbox, run } = boot({ [STORAGE_KEY]: JSON.stringify(rows) });
  put(sandbox, [...rows, form('row-3', 'three')]);
  run('deleteForm("row-1")');
  const ids = idsOf(stored(sandbox));
  assert.deepEqual(ids.slice().sort(), ['row-2', 'row-3']);
  assert.ok(JSON.parse(sandbox.localStorage.getItem(DELETED_KEY)).includes('row-1'));
});

test('a deleted id is not resurrected when this tab still has the row in memory', () => {
  const row1 = form('row-1', 'one');
  const row2 = form('row-2', 'two');
  const { sandbox, run } = boot({ [STORAGE_KEY]: JSON.stringify([row1, row2]) });
  run('deleteForm("row-2")');
  run(`forms.push(${JSON.stringify(row2)}); persist();`);
  assert.deepEqual(idsOf(stored(sandbox)), ['row-1']);
  assert.ok(JSON.parse(sandbox.localStorage.getItem(DELETED_KEY)).includes('row-2'));
});

test('load hides an id the deleted list already names', () => {
  const { run } = boot({
    [STORAGE_KEY]: JSON.stringify([form('row-1', 'one'), form('row-2', 'two')]),
    [DELETED_KEY]: JSON.stringify(['row-2']),
  });
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].id'), 'row-1');
});

test('an edit of a row the other tab deleted is kept under a new id', () => {
  const row1 = form('row-1', 'old');
  const { sandbox, run, alerts } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  run('editForm("row-1"); current.free.best = "kept";');
  put(sandbox, []);
  sandbox.localStorage.setItem(DELETED_KEY, JSON.stringify(['row-1']));
  run('saveForm()');
  const disk = stored(sandbox);
  assert.equal(disk.length, 1);
  assert.notEqual(disk[0].id, 'row-1');
  assert.equal(disk[0].free.best, 'kept');
  assert.ok(JSON.parse(sandbox.localStorage.getItem(DELETED_KEY)).includes('row-1'));
  assert.ok(alerts.some(a => /toisessa välilehdessä/i.test(a) && /uutena/.test(a)));
});

test('clearAll deletes only ids this tab had and keeps one it never loaded', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  put(sandbox, [row1, form('row-2', 'two')]);
  run('clearAll()');
  assert.deepEqual(idsOf(stored(sandbox)), ['row-2']);
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].id'), 'row-2');
  assert.ok(JSON.parse(sandbox.localStorage.getItem(DELETED_KEY)).includes('row-1'));
  assert.ok(alerts.some(a => /ei poistettu/.test(a)));
});

test('clearAll on a corrupt canonical blob keeps a recovery row this tab never loaded', () => {
  const blob = '{not-json';
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts } = boot({
    [STORAGE_KEY]: blob,
    [RECOVERY_KEY]: JSON.stringify([row1]),
  });
  put(sandbox, [row1, form('row-2', 'two')], RECOVERY_KEY);
  run('clearAll()');
  assert.equal(sandbox.localStorage.getItem(RECOVERY_KEY), null);
  assert.notEqual(sandbox.localStorage.getItem(STORAGE_KEY), blob);
  assert.deepEqual(idsOf(stored(sandbox)), ['row-2']);
  assert.equal(run('forms[0].id'), 'row-2');
  assert.equal(run('storageUnreadable'), false);
  assert.ok(JSON.parse(sandbox.localStorage.getItem(DELETED_KEY)).includes('row-1'));
  assert.ok(alerts.some(a => /ei poistettu/.test(a)));
});

test('a save while the canonical blob is corrupt merges the recovery key and leaves the blob', () => {
  const blob = '{not-json';
  const row1 = form('row-1', 'one');
  const { sandbox, run } = boot({
    [STORAGE_KEY]: blob,
    [RECOVERY_KEY]: JSON.stringify([row1]),
  });
  put(sandbox, [row1, form('row-2', 'two')], RECOVERY_KEY);
  run('current.attendance = "fri"; saveForm();');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), blob);
  const ids = idsOf(stored(sandbox, RECOVERY_KEY));
  assert.ok(ids.includes('row-1') && ids.includes('row-2'));
  assert.equal(ids.length, 3);
});
