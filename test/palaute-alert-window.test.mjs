// A storage warning shown between persist's read and its write (finding #6707)
// lets the other tab commit a save during the dialog; the write that follows
// then drops that save. Each test has the other tab write while an alert is
// open and checks that its rows and deletes survive.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';
const RECOVERY_KEY = STORAGE_KEY + '_recovery';
const DELETED_KEY = STORAGE_KEY + '_deleted';
const RECOVERY_DELETED_KEY = RECOVERY_KEY + '_deleted';

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

// `duringAlert(storage)` runs inside the first alert the page shows after boot,
// standing in for the other tab's save while the dialog is open.
function boot(seed) {
  const alerts = [];
  const state = { duringAlert: null };
  const { sandbox, run, loadError } = loadPage(PALAUTE_PATH, {
    seed,
    patch(s) {
      s.alert = (msg) => {
        alerts.push(String(msg));
        const fn = state.duringAlert;
        state.duringAlert = null;
        if (fn) fn(s.localStorage);
      };
      s.confirm = () => true;
    },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  return { sandbox, run, alerts, state };
}

function read(sandbox, key) {
  const raw = sandbox.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

// The other tab's save as its persist() does it: re-read the key, then write.
function otherTabAdds(key, row) {
  return (ls) => {
    const raw = ls.getItem(key);
    ls.setItem(key, JSON.stringify([...(raw ? JSON.parse(raw) : []), row]));
  };
}

function idsOf(list) {
  return (list || []).filter(f => f && typeof f.id === 'string').map(f => f.id);
}

test('a held-rows warning does not drop a row the other tab saves during it', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts, state } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  sandbox.localStorage.setItem(STORAGE_KEY, JSON.stringify([row1, 42]));
  state.duringAlert = otherTabAdds(STORAGE_KEY, form('row-2', 'two'));
  run('current.attendance = "both"; saveForm();');
  assert.ok(alerts.some(a => /vahingoittunut/.test(a)), 'the held-rows warning still shows');
  const ids = idsOf(read(sandbox, STORAGE_KEY));
  assert.ok(ids.includes('row-2'), 'the other tab\'s save survives');
  assert.equal(ids.length, 3);
});

test('a held-rows warning does not undo a delete the other tab commits during it', () => {
  const row1 = form('row-1', 'one');
  const row2 = form('row-2', 'two');
  const { sandbox, run, state } = boot({ [STORAGE_KEY]: JSON.stringify([row1, row2]) });
  sandbox.localStorage.setItem(STORAGE_KEY, JSON.stringify([row1, row2, 42]));
  state.duringAlert = (ls) => {
    ls.setItem(DELETED_KEY, JSON.stringify([...JSON.parse(ls.getItem(DELETED_KEY) || '[]'), 'row-2']));
    ls.setItem(STORAGE_KEY, JSON.stringify(JSON.parse(ls.getItem(STORAGE_KEY))
      .filter(f => !(f && f.id === 'row-2'))));
  };
  run('current.attendance = "both"; saveForm();');
  assert.ok(!idsOf(read(sandbox, STORAGE_KEY)).includes('row-2'), 'the deleted row stays gone');
  assert.ok(read(sandbox, DELETED_KEY).includes('row-2'), 'the delete record survives');
});

test('a corrupt deleted-list warning does not drop a row the other tab saves during it', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts, state } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  sandbox.localStorage.setItem(DELETED_KEY, '["x"');
  state.duringAlert = otherTabAdds(STORAGE_KEY, form('row-2', 'two'));
  run('current.attendance = "both"; saveForm();');
  assert.ok(alerts.length >= 1);
  assert.ok(idsOf(read(sandbox, STORAGE_KEY)).includes('row-2'));
});

test('a canonical-corrupt warning does not drop a recovery row the other tab saves during it', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts, state } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  sandbox.localStorage.setItem(STORAGE_KEY, '{not-json');
  state.duringAlert = otherTabAdds(RECOVERY_KEY, form('row-2', 'two'));
  run('current.attendance = "both"; saveForm();');
  assert.ok(alerts.length >= 1);
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), '{not-json');
  const ids = idsOf(read(sandbox, RECOVERY_KEY));
  assert.ok(ids.includes('row-2'), 'the other tab\'s recovery row survives');
  assert.ok(ids.includes('row-1'));
});

test('clearAll keeps a recovery row the other tab saves during its tombstone warning', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, state } = boot({
    [STORAGE_KEY]: '{not-json',
    [RECOVERY_KEY]: JSON.stringify([row1]),
  });
  sandbox.localStorage.setItem(RECOVERY_DELETED_KEY, '["x"');
  // The other tab still writes the recovery key: it has not seen this wipe.
  state.duringAlert = otherTabAdds(RECOVERY_KEY, form('row-2', 'two'));
  run('clearAll()');
  const kept = idsOf(read(sandbox, STORAGE_KEY)).concat(idsOf(read(sandbox, RECOVERY_KEY)));
  assert.deepEqual(kept, ['row-2']);
});

test('the deferred warnings still show before the quota alert of a failed write', () => {
  const row1 = form('row-1', 'one');
  const { sandbox, run, alerts } = boot({ [STORAGE_KEY]: JSON.stringify([row1]) });
  sandbox.localStorage.setItem(STORAGE_KEY, JSON.stringify([row1, 42]));
  sandbox.localStorage.setItem = () => {
    const err = new Error('The quota has been exceeded.');
    err.name = 'QuotaExceededError';
    throw err;
  };
  run('current.attendance = "both"; saveForm();');
  const held = alerts.findIndex(a => /vahingoittunut/.test(a));
  const quota = alerts.findIndex(a => /täynnä/.test(a));
  assert.ok(held >= 0 && quota > held, alerts.join(' | '));
});
