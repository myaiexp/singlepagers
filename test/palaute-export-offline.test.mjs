// Offline export fallback (audit #1375): when ExcelJS cannot load, exportExcel()
// must still deliver the three sheets as JSON via exportJsonFallback — never
// fail closed with only an alert. Same no-deps harness as palaute-sheets.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSandbox } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no inline <script> block found in palaute.html');
  return m[1];
}

function loadPage({ withExcelJS = false } = {}) {
  const downloads = [];
  const alerts = [];
  const sandbox = createSandbox({});
  sandbox.JSON = JSON;
  sandbox.Date = Date;
  sandbox.alert = (msg) => { alerts.push(String(msg)); };
  sandbox.Blob = function Blob(parts, opts) {
    this.parts = parts;
    this.type = opts?.type || '';
    this._text = parts.map(p => (typeof p === 'string' ? p : '')).join('');
  };
  sandbox.URL = {
    createObjectURL: (blob) => {
      downloads.push({ blob, type: blob.type, text: blob._text });
      return 'blob:stub';
    },
    revokeObjectURL() {},
  };

  if (withExcelJS) {
    // Minimal Workbook that still produces a download via writeBuffer
    class Workbook {
      constructor() { this.worksheets = []; }
      addWorksheet(name) {
        const ws = {
          name, rows: [],
          addRow(r) { this.rows.push(r); return { getCell: () => ({}) }; },
          getRow: () => ({ getCell: () => ({}), height: 0 }),
          getColumn: () => ({}),
          getCell: () => ({}),
          addConditionalFormatting() {},
        };
        this.worksheets.push(ws);
        return new Proxy(ws, {
          get(t, p) {
            if (p in t) return t[p];
            return () => new Proxy({}, { get: () => () => ({}) });
          },
          set() { return true; },
        });
      }
      get xlsx() { return { writeBuffer: async () => new Uint8Array([1, 2, 3]) }; }
    }
    sandbox.ExcelJS = { Workbook };
  }
  // No ExcelJS global → loadExcelJS will try to inject a script and fail

  vm.createContext(sandbox);
  try {
    vm.runInContext(extractScript(readFileSync(palautePath, 'utf8')), sandbox, {
      filename: 'palaute.html#script',
    });
  } catch {
    // Load-time DOM-stub miss in boot — tolerated.
  }

  // Force loadExcelJS to reject when ExcelJS is absent (script injection is a no-op under stub)
  if (!withExcelJS) {
    vm.runInContext(
      `loadExcelJS = () => Promise.reject(new Error('ExcelJS load failed'));`,
      sandbox,
    );
  }

  const run = (code) => vm.runInContext(code, sandbox);
  return { run, downloads, alerts, sandbox };
}

const FORMS = [
  { id: 'a', attendance: 'both', ratings: [5, 4, 3, 2, 1, null, 5], recommend: 'kylla',
    free: { best: 'Hyvä', improve: '', topics: '', open: '' }, name: 'A', phone: '111' },
];

test('exportExcel falls back to JSON with three sheets when ExcelJS is unavailable', async () => {
  const { run, downloads, alerts } = loadPage({ withExcelJS: false });
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportExcel()');

  assert.equal(downloads.length, 1, 'exactly one download');
  const dl = downloads[0];
  assert.match(dl.type, /json/i, 'download is application/json');
  const payload = JSON.parse(dl.text);
  assert.equal(payload.format, 'palaute-export-v1');
  assert.equal(payload.formCount, 1);
  assert.equal(payload.forms.length, 1);
  assert.deepEqual(
    Object.keys(payload.sheets),
    ['Vastaukset', 'Yhteenveto', 'Avoimet teemat'],
  );
  // Vastaukset: header + one data row
  assert.equal(payload.sheets['Vastaukset'].length, 2);
  assert.ok(alerts.some(a => /JSON/i.test(a)), 'operator is told about JSON fallback');
});

test('exportJsonFallback alone produces the same three-sheet payload', () => {
  const { run, downloads } = loadPage({ withExcelJS: false });
  run(`forms = ${JSON.stringify(FORMS)};`);
  run('exportJsonFallback()');
  assert.equal(downloads.length, 1);
  const payload = JSON.parse(downloads[0].text);
  assert.equal(payload.sheets['Vastaukset'][1][1], 'Molemmat päivät'); // attLabel
});

test('exportExcel still prefers xlsx when ExcelJS is present', async () => {
  const { run, downloads, alerts } = loadPage({ withExcelJS: true });
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportExcel()');
  assert.equal(downloads.length, 1);
  // xlsx path uses ArrayBuffer → non-json mime
  assert.doesNotMatch(downloads[0].type || '', /json/i);
  assert.equal(alerts.length, 0, 'no fallback alert when Excel succeeds');
});
