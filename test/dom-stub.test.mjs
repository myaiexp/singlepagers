// Harness contract (audit #8252, finding #9603, finding #10538): extractInlineScript,
// loadPage and the sandbox patches live in dom-stub.mjs, page paths in pages.mjs,
// yatzy scorecards in yatzy-fixtures.mjs and the ExcelJS stub in
// palaute-fixtures.mjs, so page tests do not reimplement the boot, its patches,
// or restate the page's data model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractInlineScript, loadPage, createDocument, createSandbox,
  stableElements, captureAlerts, captureCreated, captureDownloads, queueTimers, spyOn,
  dispatch, listeners,
} from './dom-stub.mjs';
import { createExcelJSStub } from './palaute-fixtures.mjs';
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

test('dispatch calls registered listeners in order with one shared event', () => {
  const doc = createDocument();
  const seen = [];
  const a = (e) => seen.push(['a', e.key]);
  const b = (e) => { seen.push(['b', e.key]); e.preventDefault(); };
  doc.addEventListener('keydown', a);
  doc.addEventListener('keydown', b);
  const ev = dispatch(doc, 'keydown', { key: '3' });
  assert.deepEqual(seen, [['a', '3'], ['b', '3']]);
  assert.equal(ev.defaultPrevented, true);
  doc.removeEventListener('keydown', a);
  assert.deepEqual(listeners(doc, 'keydown'), [b]);
});

test('element listeners key to the element they were added on', () => {
  const el = createDocument().getElementById('x');
  let got;
  el.addEventListener('input', (e) => { got = e.target; });
  dispatch(el, 'input');
  assert.equal(got, el);
  assert.equal(listeners(createDocument().getElementById('x'), 'input').length, 0);
});

test('default document: fresh nodes and an always-false classList', () => {
  const doc = createDocument();
  assert.notEqual(doc.getElementById('a'), doc.getElementById('a'));
  const el = doc.getElementById('a');
  el.classList.add('hidden');
  assert.equal(el.classList.contains('hidden'), false);
});

test('stableElements descendants keeps nodes per selector until innerHTML is reassigned', () => {
  const sandbox = createSandbox();
  const byId = stableElements(sandbox, { descendants: true });
  const entry = sandbox.document.getElementById('entry');
  assert.equal(byId.get('entry'), entry);
  const input = entry.querySelector('#r-name');
  const list = entry.querySelectorAll('.att');
  assert.equal(entry.querySelector('#r-name'), input);
  assert.equal(entry.querySelectorAll('.att'), list);
  entry.classList.add('hidden');
  list[0].classList.add('sel');
  assert.equal(entry.classList.contains('hidden'), true);
  assert.equal(list[0].classList.contains('sel'), true);
  input.focus();
  assert.equal(input.focused, true);
  entry.innerHTML = '<p>re-render</p>';
  assert.notEqual(entry.querySelector('#r-name'), input);
  assert.equal(entry.querySelector('#r-name').focused, false, 'a re-rendered node starts unfocused');
  assert.notEqual(entry.querySelectorAll('.att'), list);
});

test('captureDownloads records each object URL, its blob text, and its revoke', () => {
  const sandbox = createSandbox();
  const downloads = captureDownloads(sandbox);
  const a = sandbox.URL.createObjectURL(new sandbox.Blob(['{"a":', '1}'], { type: 'application/json' }));
  const b = sandbox.URL.createObjectURL(new sandbox.Blob([new Uint8Array([1])]));
  assert.notEqual(a, b);
  sandbox.URL.revokeObjectURL(a);
  assert.deepEqual(
    downloads.map(({ type, text, url, revoked }) => ({ type, text, url, revoked })),
    [
      { type: 'application/json', text: '{"a":1}', url: a, revoked: true },
      { type: '', text: '', url: b, revoked: false },
    ],
  );
});

test('queueTimers holds callbacks until flush and honours clearTimeout', () => {
  const sandbox = createSandbox();
  const { timers, flush } = queueTimers(sandbox);
  const ran = [];
  sandbox.setTimeout((x) => { ran.push(x); sandbox.setTimeout(() => ran.push('nested')); }, 10, 'a');
  const id = sandbox.setTimeout(() => ran.push('cleared'), 20);
  sandbox.clearTimeout(id);
  assert.deepEqual(timers.map((t) => t.ms), [10]);
  assert.deepEqual(ran, []);
  flush();
  assert.deepEqual(ran, ['a'], 'a callback queued during flush waits for the next one');
  flush();
  assert.deepEqual(ran, ['a', 'nested']);
});

test('spyOn counts calls through the page global, including internal ones', () => {
  const { sandbox, run } = loadPage(YATZY_PATH);
  const spy = spyOn(sandbox, 'getDieFace');
  assert.equal(run('getDieFace(3)'), '⚂', 'the spy forwards to the original');
  run('getDieFace(6)');
  assert.equal(spy.count, 2);
  assert.deepEqual(spy.calls.map((args) => [...args]), [[3], [6]]);
  assert.throws(() => spyOn(sandbox, 'noSuchFunction'), /not a function/);
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
