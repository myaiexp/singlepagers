// Excel-export integration tests (audit #1): drive palaute.html's real exportForms()
// through a RECORDING ExcelJS stub and read back what the workbook received —
// sheet names, header-row contents, row counts, and computed averages — so a wiring
// bug in the three sheet builders (Vastaukset / Yhteenveto / Avoimet teemat) fails
// loudly instead of producing a silently misaligned spreadsheet.
//
// Same no-deps harness as palaute-labels.test.mjs: loadPage runs the page's
// real <script> under node:vm against the stub DOM. ExcelJS, Blob and URL are
// injected so loadExcelJS() short-circuits (no network) and downloadBlob() is
// inert. The shared stub captures every addWorksheet(name)/addRow(row); styling
// calls hit a forgiving proxy and are ignored — only the data wiring is under
// test here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, createExcelJSStub } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const { ExcelJS, workbooks } = createExcelJSStub();
const { run } = loadPage(PALAUTE_PATH, {
  patch(sandbox) {
    sandbox.ExcelJS = ExcelJS;
    sandbox.Blob = function Blob() {};
    sandbox.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL() {} };
  },
});

// Three forms with known values. Note f1.best "Hyvä tilaisuus" and f2.best
// "hyvä tilaisuus" differ only in case — they must MERGE in the themes sheet (#16).
const FORMS = [
  { id: 'a', attendance: 'both', ratings: [5, 4, 3, 2, 1, null, 5], recommend: 'kylla',
    free: { best: 'Hyvä tilaisuus', improve: '', topics: 'Lisää aikaa', open: '' }, name: 'A', phone: '111' },
  { id: 'b', attendance: 'thu', ratings: [3, 4, 5, 1, 2, 3, null], recommend: 'ehka',
    free: { best: 'hyvä tilaisuus', improve: 'Enemmän taukoja', topics: 'Lisää aikaa', open: '' }, name: '', phone: '' },
  { id: 'c', attendance: 'fri', ratings: [null, null, null, null, null, null, null], recommend: 'en',
    free: { best: '', improve: '', topics: '', open: 'Kiitos' }, name: 'B', phone: '222' },
];

// Run the real exportForms() once and return the captured worksheets by name.
async function exportAndCapture() {
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportForms()');
  const wb = workbooks[workbooks.length - 1];
  const byName = {};
  wb.worksheets.forEach(ws => { byName[ws.name] = ws.rows; });
  return byName;
}

test('exportForms builds exactly the three expected sheets, in order', async () => {
  const sheets = await exportAndCapture();
  assert.deepEqual(Object.keys(sheets), ['Vastaukset', 'Yhteenveto', 'Avoimet teemat']);
});

test('Vastaukset header + one row per respondent, columns aligned to config', async () => {
  const sheets = await exportAndCapture();
  const rows = sheets['Vastaukset'];
  const RATING = run('JSON.stringify(RATING_ITEMS)') && JSON.parse(run('JSON.stringify(RATING_ITEMS)'));
  const FREETEXT_Q = JSON.parse(run('JSON.stringify(FREETEXT.map(f => f.question))'));

  // header: # | Osallistui | <7 ratings> | Suosittelisi | <4 free-text qs> | Nimi | Puhelinnumero
  const header = rows[0];
  const expectedHeader = ['#', 'Osallistui', ...RATING, 'Suosittelisi', ...FREETEXT_Q, 'Nimi', 'Puhelinnumero'];
  assert.equal(JSON.stringify([...header]), JSON.stringify(expectedHeader));

  // one header row + one row per form
  assert.equal(rows.length, FORMS.length + 1);

  // f1's row carries the right labels, ratings (null → ""), and free-text in order
  assert.equal(JSON.stringify([...rows[1]]), JSON.stringify(
    [1, 'Molemmat päivät', 5, 4, 3, 2, 1, '', 5, 'Kyllä', 'Hyvä tilaisuus', '', 'Lisää aikaa', '', 'A', '111']));
});

test('Yhteenveto average column equals the manual mean for a rating row', async () => {
  const sheets = await exportAndCapture();
  const rows = sheets['Yhteenveto'].map(r => [...r]);
  // RATING_ITEMS[0] "Tapahtuman kokonaisuus": values across forms = 5, 3, (skipped)
  // → mean (5+3)/2 = 4.0 over 2 responses; counts: one 3 and one 5.
  const label = JSON.parse(run('JSON.stringify(RATING_ITEMS[0])'));
  const row = rows.find(r => r[0] === label);
  assert.ok(row, 'rating row present in summary');
  // row = [label, c1, c2, c3, c4, c5, Vastauksia, Keskiarvo]
  assert.deepEqual(row.slice(1), [0, 0, 1, 0, 1, 2, 4]);
});

test('Avoimet teemat merges case-insensitive duplicate answers (#16)', async () => {
  const sheets = await exportAndCapture();
  const rows = sheets['Avoimet teemat'].map(r => [...r]);
  // "Hyvä tilaisuus" + "hyvä tilaisuus" must collapse to one row, count 2, first-seen casing.
  const best = rows.filter(r => String(r[0]).toLowerCase() === 'hyvä tilaisuus');
  assert.equal(best.length, 1, 'the two casings collapse to a single grouped row');
  assert.deepEqual(best[0], ['Hyvä tilaisuus', 2]);
  // "Lisää aikaa" appears in two forms identically → count 2.
  const topic = rows.find(r => r[0] === 'Lisää aikaa');
  assert.deepEqual(topic, ['Lisää aikaa', 2]);
});
