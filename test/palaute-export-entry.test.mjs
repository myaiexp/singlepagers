// The entry on screen versus export, clear and review (idea #6705): exportForms
// used to serialize only saved forms, so a typed-but-unsaved response — often
// the last one of the event, with raffle contacts — never reached the file,
// and clearAll discarded it without naming it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts, captureDownloads } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';

function bootPalaute({ confirmValue = true } = {}) {
  let alerts, downloads;
  const confirms = [];
  const confirmCtl = { value: confirmValue };
  const { sandbox, run } = loadPage(PALAUTE_PATH, {
    patch(s) {
      alerts = captureAlerts(s);
      downloads = captureDownloads(s);
      s.confirm = (msg) => { confirms.push(msg); return confirmCtl.value; };
    },
  });
  // The JSON fallback carries the same rows as the workbook and is readable here.
  run(`loadExcelJS = () => Promise.reject(new Error('ExcelJS load failed'));`);
  return { run, sandbox, alerts, downloads, confirms, confirmCtl };
}

function typeEntry(run, best = 'Hyvä', name = 'Arvottava', phone = '0401234567') {
  run(`
    current.attendance = "both";
    current.free.best = ${JSON.stringify(best)};
    current.name = ${JSON.stringify(name)};
    current.phone = ${JSON.stringify(phone)};
  `);
}

function payloadOf(downloads) {
  assert.equal(downloads.length, 1, 'exactly one download');
  return JSON.parse(downloads[0].text);
}

test('export saves and includes a first form that was never saved', async () => {
  const { run, sandbox, downloads, confirms } = bootPalaute();
  typeEntry(run);
  await run('exportForms()');

  assert.equal(confirms.length, 1, 'the operator is asked about the open entry');
  assert.match(confirms[0], /tallentamaton/);
  const payload = payloadOf(downloads);
  assert.equal(payload.formCount, 1);
  assert.equal(payload.forms[0].name, 'Arvottava');
  assert.equal(payload.sheets['Vastaukset'][1].at(-1), '0401234567');
  assert.equal(JSON.parse(sandbox.localStorage.getItem(STORAGE_KEY)).length, 1,
    'the exported entry is also stored, so the file and the device agree');
  assert.equal(run('hasUnsavedEntry()'), false);
});

test('declining the save exports the saved forms only and keeps the entry', async () => {
  const { run, downloads, confirmCtl } = bootPalaute();
  typeEntry(run, 'Eka');
  run('saveForm()');
  typeEntry(run, 'Toka');
  confirmCtl.value = false;
  await run('exportForms()');

  const payload = payloadOf(downloads);
  assert.equal(payload.formCount, 1);
  assert.equal(payload.forms[0].free.best, 'Eka');
  assert.equal(run('current.free.best'), 'Toka', 'the open entry is left on screen');
});

test('declining the save with nothing stored downloads nothing', async () => {
  const { run, downloads, alerts } = bootPalaute({ confirmValue: false });
  typeEntry(run);
  await run('exportForms()');
  assert.equal(downloads.length, 0);
  assert.ok(alerts.some(a => a.includes('Ei vielä tallennettuja lomakkeita')));
});

test('export of an open edit writes the on-screen text, not the last saved copy', async () => {
  const { run, downloads, confirmCtl } = bootPalaute();
  typeEntry(run, 'Vanha');
  run('saveForm()');
  confirmCtl.value = true;
  run('editForm(forms[0].id)');
  run('current.free.best = "Uusi"; current.phone = "0509999999";');
  await run('exportForms()');

  const payload = payloadOf(downloads);
  assert.equal(payload.formCount, 1, 'the edit replaces its row, it does not add one');
  assert.equal(payload.forms[0].free.best, 'Uusi');
  assert.equal(payload.forms[0].phone, '0509999999');
  assert.equal(run('editingId'), null, 'the edit is closed by the save');
});

test('a blank or unchanged entry exports without asking', async () => {
  const { run, downloads, confirms } = bootPalaute();
  typeEntry(run);
  run('saveForm()');
  run('current.free.best = "   ";'); // whitespace only: not a response
  await run('exportForms()');
  assert.equal(confirms.length, 0);
  assert.equal(payloadOf(downloads).formCount, 1);
});

test('clearAll names an open new entry in its confirm', () => {
  const { run, confirms, confirmCtl } = bootPalaute({ confirmValue: false });
  typeEntry(run, 'Eka');
  run('saveForm()');
  typeEntry(run, 'Toka');
  run('clearAll()');
  assert.match(confirms.at(-1), /1 lomaketta ja syötössä oleva tallentamaton lomake/);
  assert.equal(run('current.free.best'), 'Toka', 'a declined clear keeps the entry');

  confirmCtl.value = true;
  run('clearAll()');
  assert.equal(run('hasUnsavedEntry()'), false);
});

test('clearAll names unsaved edits in its confirm', () => {
  const { run, confirms, confirmCtl } = bootPalaute();
  typeEntry(run);
  run('saveForm()');
  run('editForm(forms[0].id)');
  run('current.phone = "0501111111";');
  confirmCtl.value = false;
  run('clearAll()');
  assert.match(confirms.at(-1), /tallentamattomat muutokset/);
});

test('clearAll without an open entry names only the saved forms', () => {
  const { run, confirms } = bootPalaute({ confirmValue: false });
  typeEntry(run);
  run('saveForm()');
  run('clearAll()');
  assert.doesNotMatch(confirms.at(-1), /tallentamat/);
});

test('review tells the operator an unsaved entry is not in the list', () => {
  const { run } = bootPalaute();
  typeEntry(run);
  run('showReview()');
  assert.match(run('reviewEl.innerHTML'), /tallentamaton/, 'shown even with no saved forms');

  run('showEntry(); saveForm(); showReview();');
  assert.doesNotMatch(run('reviewEl.innerHTML'), /tallentamaton/);
});
