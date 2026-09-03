// Harness contract (audit #8252): extractInlineScript, loadPage, and the shared
// ExcelJS stub live in dom-stub.mjs so page tests do not reimplement the boot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractInlineScript, loadPage, createExcelJSStub } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');
const yatzyPath = join(here, '..', 'yatzy.html');

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
  const { run } = loadPage(palautePath);
  assert.equal(run('attLabel("both")'), 'Molemmat päivät');
});

test('loadPage applies patch before the page script runs', () => {
  const seen = [];
  const { run } = loadPage(palautePath, {
    patch(sandbox) {
      sandbox.alert = (msg) => seen.push(String(msg));
    },
  });
  run('alert("hi")');
  assert.deepEqual(seen, ['hi']);
});

test('loadPage seeds localStorage', () => {
  const { sandbox } = loadPage(palautePath, { seed: { k: 'v' } });
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
  for (const [name, path] of [['yatzy.html', yatzyPath], ['palaute.html', palautePath]]) {
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
