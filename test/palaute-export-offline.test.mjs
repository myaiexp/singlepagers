// Offline export fallback (audit #1375): when ExcelJS cannot load, exportExcel()
// must still deliver the three sheets as JSON via exportJsonFallback — never
// fail closed with only an alert. Same no-deps harness as palaute-sheets.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage as bootPage, createExcelJSStub } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');

function loadPage({ withExcelJS = false, stubLoadExcelJS = !withExcelJS, realTimers = false } = {}) {
  const downloads = [];
  const alerts = [];
  const { run } = bootPage(palautePath, {
    patch(sandbox) {
      if (realTimers) {
        sandbox.setTimeout = setTimeout;
        sandbox.clearTimeout = clearTimeout;
      }
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
        sandbox.ExcelJS = createExcelJSStub({ buffer: new Uint8Array([1, 2, 3]) }).ExcelJS;
      }
    },
  });

  // Force loadExcelJS to reject when ExcelJS is absent (script injection is a no-op under stub)
  if (stubLoadExcelJS) {
    run(`loadExcelJS = () => Promise.reject(new Error('ExcelJS load failed'));`);
  }

  return { run, downloads, alerts };
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

test('loadExcelJS times out, clears the cached promise, and lets a retry start fresh', async () => {
  const { run } = loadPage({ stubLoadExcelJS: false, realTimers: true });
  run('EXCELJS_LOAD_TIMEOUT_MS = 40');
  const first = run('loadExcelJS()');
  await assert.rejects(first, /timed out/i);
  assert.equal(run('excelJsLoad'), null, 'cached promise must be cleared so a retry can inject a fresh script');
  const second = run('loadExcelJS()');
  assert.notEqual(second, first);
  await assert.rejects(second, /timed out/i);
}, { timeout: 2000 });

test('exportExcel falls back to JSON when the ExcelJS script hangs past the timeout', async () => {
  const { run, downloads, alerts } = loadPage({ stubLoadExcelJS: false, realTimers: true });
  run('EXCELJS_LOAD_TIMEOUT_MS = 40');
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportExcel()');
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].type, /json/i);
  assert.ok(alerts.some(a => /JSON/i.test(a)));
}, { timeout: 2000 });

test('exportExcel still prefers xlsx when ExcelJS is present', async () => {
  const { run, downloads, alerts } = loadPage({ withExcelJS: true });
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportExcel()');
  assert.equal(downloads.length, 1);
  // xlsx path uses ArrayBuffer → non-json mime
  assert.doesNotMatch(downloads[0].type || '', /json/i);
  assert.equal(alerts.length, 0, 'no fallback alert when Excel succeeds');
});

// The empty-store guard is the only thing standing between "nothing to export"
// and a download of an empty workbook. Removing `if (!forms.length)` used to
// pass the suite.
test('exportExcel with zero forms alerts and does not download', async () => {
  const { run, downloads, alerts } = loadPage({ withExcelJS: true });
  run('forms = [];');
  await run('exportExcel()');
  assert.equal(downloads.length, 0, 'no workbook download for an empty store');
  assert.ok(
    alerts.some(a => a.includes('Ei vielä tallennettuja lomakkeita')),
    'operator is told there is nothing to export',
  );
});

// SRI wiring is independent of whether the script actually loads: dropping
// `s.integrity = EXCELJS_SRI` still produces a working export (and a green
// suite) while the page starts executing an unverified third-party script.
test('loadExcelJS pins integrity and anonymous crossOrigin on the injected script', () => {
  const created = [];
  const { run } = bootPage(palautePath, {
    patch(sandbox) {
      const orig = sandbox.document.createElement;
      sandbox.document.createElement = (tag) => {
        const el = orig(tag);
        created.push({ tag, el });
        return el;
      };
    },
  });
  run('loadExcelJS()');
  const script = created.find(c => c.tag === 'script');
  assert.ok(script, 'loadExcelJS injects a <script> element');
  assert.equal(script.el.src, run('EXCELJS_URL'));
  assert.equal(script.el.integrity, run('EXCELJS_SRI'));
  assert.match(run('EXCELJS_SRI'), /^sha512-/);
  assert.equal(script.el.crossOrigin, 'anonymous');
});
