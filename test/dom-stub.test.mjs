// Harness contract (audit #8252, finding #9603): extractInlineScript, loadPage,
// the sandbox patches and the shared ExcelJS stub live in dom-stub.mjs, page
// paths in pages.mjs and yatzy scorecards in yatzy-fixtures.mjs, so page tests
// do not reimplement the boot or restate the page's data model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractInlineScript, loadPage, createExcelJSStub,
  stableElements, captureAlerts, captureCreated,
} from './dom-stub.mjs';
import { PALAUTE_PATH, YATZY_PATH } from './pages.mjs';
import { scorecardTotalling } from './yatzy-fixtures.mjs';

test('extractInlineScript returns the attribute-free <script> body', () => {
  const html = '<html><script src="https://cdn.example/lib.js"></script><script>var x = 1;</script></html>';
  assert.equal(extractInlineScript(html).trim(), 'var x = 1;');
});

test('extractInlineScript throws when there is no inline script', () => {
  assert.throws(
    () => extractInlineScript('<html><script src="lib.js"></script></html>', 'empty.html'),
    /no inline <script> block found in empty\.html/,
  );
});

test('loadPage exposes page functions via run()', () => {
  const { run } = loadPage(PALAUTE_PATH);
  assert.equal(run('attLabel("both")'), 'Molemmat päivät');
});

test('loadPage applies patch before the page script runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dom-stub-'));
  const htmlPath = join(dir, 'boot-alert.html');
  writeFileSync(htmlPath, '<script>alert("booted");</script>');
  try {
    let seen;
    const { run } = loadPage(htmlPath, {
      patch(sandbox) { seen = captureAlerts(sandbox); },
    });
    run('alert(42)');
    assert.deepEqual(seen, ['booted', '42'], 'the load-time alert hit the patch; messages are strings');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stableElements returns one element per key and can record classes', () => {
  let byId;
  let bySelector;
  const { run } = loadPage(YATZY_PATH, {
    patch(sandbox) {
      byId = stableElements(sandbox, { recordClasses: true });
      bySelector = stableElements(sandbox, { method: 'querySelector' });
    },
  });
  run(`document.getElementById('gameOver').classList.add('show');
       document.getElementById('winnerText').innerHTML = 'x';`);
  assert.equal(run(`document.getElementById('winnerText').innerHTML`), 'x');
  assert.equal(byId.get('gameOver').classList.contains('show'), true);
  assert.notEqual(byId.get('gameOver'), byId.get('winnerText'));
  assert.equal(run(`document.querySelector('#a') === document.querySelector('#a')`), true);
  assert.ok(bySelector.has('#a'));
});

test('captureCreated records elements and runs onCreate before the page gets them', () => {
  let created;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) {
      created = captureCreated(sandbox, (el, tag) => { el.stamped = tag; });
    },
  });
  const before = created.length;
  assert.equal(run(`document.createElement('a').stamped`), 'a');
  assert.deepEqual(created.slice(before).map((c) => c.tag), ['a']);
});

test("scorecardTotalling uses the page's rows and totals what it is asked", () => {
  const { run } = loadPage(YATZY_PATH);
  const card = scorecardTotalling(run, 63, 40);
  const ids = (c) => [...c.upper, ...c.lower].map((r) => r.id);
  const page = JSON.parse(run('JSON.stringify(scoreCategories)'));
  assert.deepEqual(ids(card), ids(page), 'every row, in page order');
  assert.ok([...card.upper, ...card.lower].every((r) => r.value !== null), 'card is complete');
  assert.equal(run(`calculateUpperTotal(${JSON.stringify(card)})`), 63);
  assert.equal(card.lower.reduce((sum, r) => sum + r.value, 0), 40);
  assert.equal(run(`calculateGrandTotal(${JSON.stringify(card)})`), 63 + 40 + run('UPPER_BONUS_POINTS'));
});

test('loadPage seeds localStorage', () => {
  const { sandbox } = loadPage(PALAUTE_PATH, { seed: { k: 'v' } });
  assert.equal(sandbox.localStorage.getItem('k'), 'v');
});

test('loadPage records a load-time exception as loadError', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dom-stub-'));
  const htmlPath = join(dir, 'throws.html');
  writeFileSync(htmlPath, '<script>throw new Error("boot-fail");</script>');
  try {
    const { loadError } = loadPage(htmlPath);
    assert.ok(loadError, 'loadError must capture the thrown exception');
    assert.equal(loadError.name, 'Error');
    assert.equal(loadError.message, 'boot-fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('yatzy.html and palaute.html boot without a load-time exception', () => {
  for (const [name, path] of [['yatzy.html', YATZY_PATH], ['palaute.html', PALAUTE_PATH]]) {
    const { loadError } = loadPage(path);
    assert.equal(loadError, undefined, `${name} threw: ${loadError && loadError.stack}`);
  }
});

test('createExcelJSStub records worksheets/rows and returns the given buffer', async () => {
  const { ExcelJS, workbooks } = createExcelJSStub({ buffer: new Uint8Array([9]) });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Vastaukset');
  ws.addRow(['#', 'x']);
  assert.equal(workbooks.length, 1);
  assert.equal(workbooks[0].worksheets[0].name, 'Vastaukset');
  assert.deepEqual([...ws.rows[0]], ['#', 'x']);
  assert.deepEqual([...(await wb.xlsx.writeBuffer())], [9]);
});
