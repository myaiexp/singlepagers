// Save/edit/persist harness (audit #8234, #8246, #8232, #8237): drive palaute.html's
// real saveForm/editForm/deleteForm/clearAll/load/persist against the stub
// localStorage so an edit-save that aliases current, or a parse failure that
// clobbers the blob, fails here instead of at the venue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage as bootPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');
const STORAGE_KEY = 'palaute_huippu2026_v1';
const RECOVERY_KEY = STORAGE_KEY + '_recovery';

function loadPage(seed = {}, { confirmValue = false } = {}) {
  const alerts = [];
  const confirmCtl = { value: confirmValue };
  const { sandbox, run } = bootPage(palautePath, {
    seed,
    patch(s) {
      s.alert = (msg) => { alerts.push(String(msg)); };
      s.confirm = () => confirmCtl.value;
    },
  });
  return { run, sandbox, alerts, confirmCtl };
}

function fillCurrent(run) {
  run(`
    current.attendance = "both";
    current.ratings = [5, 4, 3, 2, 1, 5, 4];
    current.recommend = "kylla";
    current.free.best = "Hyva";
    current.name = "A";
    current.phone = "111";
  `);
}

function stored(sandbox, key = STORAGE_KEY) {
  const raw = sandbox.localStorage.getItem(key);
  return raw == null ? null : JSON.parse(raw);
}

test('saveForm persists a new form; load() round-trips it from localStorage', () => {
  const { run, sandbox } = loadPage();
  fillCurrent(run);
  run('saveForm()');

  assert.equal(run('forms.length'), 1);
  assert.equal(run('typeof forms[0].id'), 'string');
  assert.ok(run('forms[0].id'), 'saved form has a non-empty id');
  assert.equal(run('forms[0].attendance'), 'both');
  assert.equal(run('forms[0].ratings[0]'), 5);
  assert.equal(run('forms[0].free.best'), 'Hyva');

  assert.equal(run('current.id'), null, 'current is blank after new save');
  assert.ok(run('current.ratings.every(r => r === null)'));
  assert.equal(run('current.ratings === forms[0].ratings'), false);
  assert.equal(run('current.free === forms[0].free'), false);

  const disk = stored(sandbox);
  assert.equal(disk.length, 1);
  assert.equal(disk[0].id, run('forms[0].id'));
  assert.equal(disk[0].attendance, 'both');

  run('forms = load()');
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].free.best'), 'Hyva');
});

test('editForm + saveForm keeps one row, blanks current, and does not alias nested objects', () => {
  const { run } = loadPage();
  fillCurrent(run);
  run('saveForm()');
  const originalId = run('forms[0].id');

  run('editForm(forms[0].id)');
  assert.equal(run('editingId'), originalId);
  // Working copy is already detached at edit start; hold the live ratings
  // array across save so a shallow { ...current } assign is visible.
  run('heldRatings = current.ratings; heldFree = current.free;');
  run('current.ratings[0] = 1; current.free.best = "Muokattu";');
  run('saveForm()');

  assert.equal(run('forms.length'), 1, 'edit-save must not push a duplicate');
  assert.equal(run('forms[0].id'), originalId);
  assert.equal(run('forms[0].ratings[0]'), 1);
  assert.equal(run('forms[0].free.best'), 'Muokattu');
  assert.equal(run('editingId'), null);
  assert.equal(run('current.id'), null, 'current must be blanked after edit-save');
  assert.ok(run('current.ratings.every(r => r === null)'));
  assert.equal(run('current.ratings === forms[0].ratings'), false);
  assert.equal(run('current.free === forms[0].free'), false);
  assert.equal(run('heldRatings === forms[0].ratings'), false,
    'forms[idx] must deep-copy ratings, not shallow-spread them');
  assert.equal(run('heldFree === forms[0].free'), false,
    'forms[idx] must deep-copy free, not shallow-spread them');

  run('showEntry()');
  run('current.ratings[0] = 2; current.free.best = "uusi";');
  assert.equal(run('forms[0].ratings[0]'), 1,
    'mutating current after returning to entry must not rewrite the saved row');
  assert.equal(run('forms[0].free.best'), 'Muokattu');
});

test('deleteForm removes the row and persists when confirmed', () => {
  const { run, sandbox, confirmCtl } = loadPage();
  fillCurrent(run);
  run('saveForm()');
  const id = run('forms[0].id');

  confirmCtl.value = false;
  run('deleteForm(forms[0].id)');
  assert.equal(run('forms.length'), 1, 'declined confirm is a no-op');
  assert.equal(stored(sandbox).length, 1);

  confirmCtl.value = true;
  run(`deleteForm(${JSON.stringify(id)})`);
  assert.equal(run('forms.length'), 0);
  assert.deepEqual(stored(sandbox), []);
});

test('clearAll wipes forms and storage when confirmed', () => {
  const { run, sandbox, confirmCtl } = loadPage();
  fillCurrent(run);
  run('saveForm()');
  fillCurrent(run);
  run('saveForm()');
  assert.equal(run('forms.length'), 2);

  confirmCtl.value = false;
  run('clearAll()');
  assert.equal(run('forms.length'), 2);

  confirmCtl.value = true;
  run('clearAll()');
  assert.equal(run('forms.length'), 0);
  assert.deepEqual(stored(sandbox), []);
});

test('clearAll while the store is unreadable wipes both keys and returns writes to the canonical key', () => {
  const blob = '{not-json';
  const { run, sandbox, confirmCtl } = loadPage(
    { [STORAGE_KEY]: blob },
    { confirmValue: false },
  );
  fillCurrent(run);
  run('saveForm()');
  assert.equal(run('storageUnreadable'), true);
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), blob);
  assert.ok(stored(sandbox, RECOVERY_KEY), 'new row diverted to recovery');

  confirmCtl.value = true;
  run('clearAll()');

  assert.equal(run('forms.length'), 0);
  assert.equal(run('storageUnreadable'), false,
    'reset must make the store readable so persist writes STORAGE_KEY again');
  assert.deepEqual(stored(sandbox), [],
    'canonical key holds the empty store, not the leftover corrupt blob');
  assert.equal(sandbox.localStorage.getItem(RECOVERY_KEY), null,
    'recovery copy must go too, or the next load reads diverted rows back');

  fillCurrent(run);
  run('saveForm()');
  assert.equal(run('forms.length'), 1);
  assert.equal(stored(sandbox).length, 1,
    'the next save must land on the canonical key');
  assert.equal(sandbox.localStorage.getItem(RECOVERY_KEY), null);
});

test('corrupt localStorage alerts, does not clobber the blob, and persist writes a recovery key', () => {
  const blob = '{not-json';
  const { run, sandbox, alerts } = loadPage({ [STORAGE_KEY]: blob });

  assert.equal(run('forms.length'), 0, 'unreadable store boots as empty in-memory');
  assert.equal(run('storageUnreadable'), true);
  assert.ok(alerts.some(a => /vioittun|lukea|JSON|tallenn/i.test(a)),
    'operator is warned that the store could not be read');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), blob,
    'load() must not overwrite the unreadable blob');

  fillCurrent(run);
  run('saveForm()');
  assert.equal(run('forms.length'), 1, 'in-session save still works');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), blob,
    'persist() must not clobber the corrupt primary key');
  const recovered = stored(sandbox, RECOVERY_KEY);
  assert.ok(recovered, 'new rows land on the recovery key');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].attendance, 'both');
});

// Valid JSON that is not an array is just as damaged as a parse error (finding
// #10358): without load()'s Array.isArray guard, '{}' / 'null' would become
// `forms`, saveForm's push would throw or persist would rewrite the only copy
// of event responses. Seeding only '{not-json' left that guard untested.
for (const blob of ['{}', 'null', '42', '"text"']) {
  test(`non-array store ${blob} is kept, and saves divert to the recovery key across reloads`, () => {
    const first = loadPage({ [STORAGE_KEY]: blob });
    assert.equal(first.run('storageUnreadable'), true);
    assert.equal(first.run('Array.isArray(forms) && forms.length'), 0,
      'a non-array store boots as an empty array, not as the parsed value');
    assert.ok(first.alerts.some(a => /vioittun|lukea/i.test(a)),
      'operator is warned that the store could not be read');

    fillCurrent(first.run);
    first.run('saveForm()');
    assert.equal(first.sandbox.localStorage.getItem(STORAGE_KEY), blob,
      'saveForm must not overwrite the non-array blob');
    assert.equal(stored(first.sandbox, RECOVERY_KEY).length, 1,
      'the save lands on the recovery key');

    // Reload with both keys present: load() must read the recovery copy back
    // and keep diverting, not return to the canonical key.
    const second = loadPage({
      [STORAGE_KEY]: blob,
      [RECOVERY_KEY]: first.sandbox.localStorage.getItem(RECOVERY_KEY),
    });
    assert.equal(second.run('storageUnreadable'), true);
    assert.equal(second.run('forms.length'), 1, 'recovery rows are read back after reload');
    fillCurrent(second.run);
    second.run('saveForm()');
    assert.equal(second.sandbox.localStorage.getItem(STORAGE_KEY), blob,
      'a save after reload still leaves the canonical blob untouched');
    assert.equal(stored(second.sandbox, RECOVERY_KEY).length, 2);
  });
}

test('load() prefers the recovery key when the primary blob is corrupt', () => {
  const recovered = [{
    id: 'rec-1', attendance: 'thu', ratings: [4, 4, 4, 4, 4, 4, 4],
    recommend: 'kylla', free: { best: 'ok', improve: '', topics: '', open: '' },
    name: '', phone: '',
  }];
  const { run } = loadPage({
    [STORAGE_KEY]: '{nope',
    [RECOVERY_KEY]: JSON.stringify(recovered),
  });
  assert.equal(run('storageUnreadable'), true);
  assert.equal(run('forms.length'), 1);
  assert.equal(run('forms[0].id'), 'rec-1');
  assert.equal(run('forms[0].attendance'), 'thu');
});

// persist()'s quota catch is the only signal that the in-memory forms never
// reached disk. Replacing that alert with void() used to pass the suite, which
// would leave a venue operator entering more forms that vanish on tab close.
test('persist alerts on quota-exceeded and leaves in-memory forms intact', () => {
  const { run, sandbox, alerts } = loadPage();
  run(`forms = [{
    id: 'keep-me', attendance: 'both', ratings: [5, 4, 3, 2, 1, 5, 4],
    recommend: 'kylla', free: { best: 'Hyva', improve: '', topics: '', open: '' },
    name: 'A', phone: '111',
  }];`);
  const before = run('JSON.stringify(forms)');
  sandbox.localStorage.setItem = () => {
    const err = new Error('The quota has been exceeded.');
    err.name = 'QuotaExceededError';
    throw err;
  };
  run('persist()');
  assert.equal(run('JSON.stringify(forms)'), before, 'forms must survive the failed write');
  assert.equal(run('forms[0].id'), 'keep-me');
  assert.ok(
    alerts.some(a => /täynnä/.test(a) && /Vie/.test(a)),
    'operator is told the write failed and to export now',
  );
});

// cancelEdit must drop the editing session and return to review. Deleting the
// `editingId = null` reset used to pass, which would strand the page in edit
// mode after a cancel (the next save would overwrite the original row).
test('cancelEdit clears editingId, blanks current, and shows the review view', () => {
  const { run } = loadPage();
  fillCurrent(run);
  run('saveForm()');
  const originalId = run('forms[0].id');
  run('editForm(forms[0].id)');
  assert.equal(run('editingId'), originalId);
  assert.equal(run('current.name'), 'A');

  run('cancelEdit()');
  assert.equal(run('editingId'), null);
  assert.equal(run('JSON.stringify(current)'), run('JSON.stringify(blankForm())'));
  assert.equal(run('reviewBtn.textContent'), 'Takaisin syöttöön',
    'showReview must run so the operator is looking at the list, not the editor');
});
