// Save/edit/persist harness (audit #8234, #8246, #8232, #8237): drive palaute.html's
// real saveForm/editForm/deleteForm/clearAll/load/persist against the stub
// localStorage so an edit-save that aliases current, or a parse failure that
// clobbers the blob, fails here instead of at the venue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSandbox } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');
const STORAGE_KEY = 'palaute_huippu2026_v1';
const RECOVERY_KEY = STORAGE_KEY + '_recovery';

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no inline <script> block found in palaute.html');
  return m[1];
}

function loadPage(seed = {}, { confirmValue = false } = {}) {
  const alerts = [];
  const confirmCtl = { value: confirmValue };
  const sandbox = createSandbox(seed);
  sandbox.alert = (msg) => { alerts.push(String(msg)); };
  sandbox.confirm = () => confirmCtl.value;
  vm.createContext(sandbox);
  try {
    vm.runInContext(extractScript(readFileSync(palautePath, 'utf8')), sandbox, {
      filename: 'palaute.html#script',
    });
  } catch {
    // Load-time DOM-stub miss in boot — tolerated; decls below are initialized.
  }
  const run = (code) => vm.runInContext(code, sandbox);
  const runSafe = (code) => {
    try { return run(code); } catch { return undefined; }
  };
  return { run, runSafe, sandbox, alerts, confirmCtl };
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
  const { run, runSafe, sandbox } = loadPage();
  fillCurrent(run);
  runSafe('saveForm()');

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
  const { run, runSafe } = loadPage();
  fillCurrent(run);
  runSafe('saveForm()');
  const originalId = run('forms[0].id');

  runSafe('editForm(forms[0].id)');
  assert.equal(run('editingId'), originalId);
  // Working copy is already detached at edit start; hold the live ratings
  // array across save so a shallow { ...current } assign is visible.
  run('heldRatings = current.ratings; heldFree = current.free;');
  run('current.ratings[0] = 1; current.free.best = "Muokattu";');
  runSafe('saveForm()');

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

  runSafe('showEntry()');
  run('current.ratings[0] = 2; current.free.best = "uusi";');
  assert.equal(run('forms[0].ratings[0]'), 1,
    'mutating current after returning to entry must not rewrite the saved row');
  assert.equal(run('forms[0].free.best'), 'Muokattu');
});

test('deleteForm removes the row and persists when confirmed', () => {
  const { run, runSafe, sandbox, confirmCtl } = loadPage();
  fillCurrent(run);
  runSafe('saveForm()');
  const id = run('forms[0].id');

  confirmCtl.value = false;
  runSafe('deleteForm(forms[0].id)');
  assert.equal(run('forms.length'), 1, 'declined confirm is a no-op');
  assert.equal(stored(sandbox).length, 1);

  confirmCtl.value = true;
  runSafe(`deleteForm(${JSON.stringify(id)})`);
  assert.equal(run('forms.length'), 0);
  assert.deepEqual(stored(sandbox), []);
});

test('clearAll wipes forms and storage when confirmed', () => {
  const { run, runSafe, sandbox, confirmCtl } = loadPage();
  fillCurrent(run);
  runSafe('saveForm()');
  fillCurrent(run);
  runSafe('saveForm()');
  assert.equal(run('forms.length'), 2);

  confirmCtl.value = false;
  runSafe('clearAll()');
  assert.equal(run('forms.length'), 2);

  confirmCtl.value = true;
  runSafe('clearAll()');
  assert.equal(run('forms.length'), 0);
  assert.deepEqual(stored(sandbox), []);
});

test('corrupt localStorage alerts, does not clobber the blob, and persist writes a recovery key', () => {
  const blob = '{not-json';
  const { run, runSafe, sandbox, alerts } = loadPage({ [STORAGE_KEY]: blob });

  assert.equal(run('forms.length'), 0, 'unreadable store boots as empty in-memory');
  assert.equal(run('storageUnreadable'), true);
  assert.ok(alerts.some(a => /vioittun|lukea|JSON|tallenn/i.test(a)),
    'operator is warned that the store could not be read');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), blob,
    'load() must not overwrite the unreadable blob');

  fillCurrent(run);
  runSafe('saveForm()');
  assert.equal(run('forms.length'), 1, 'in-session save still works');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), blob,
    'persist() must not clobber the corrupt primary key');
  const recovered = stored(sandbox, RECOVERY_KEY);
  assert.ok(recovered, 'new rows land on the recovery key');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].attendance, 'both');
});

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
