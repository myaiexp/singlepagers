// Offline export fallback (audit #1375): when ExcelJS cannot load, exportForms()
// must still deliver the three sheets as JSON via exportJsonFallback — never
// fail closed with only an alert. Same no-deps harness as palaute-sheets.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPage, captureAlerts, captureCreated, captureDownloads, queueTimers,
} from './dom-stub.mjs';
import { createExcelJSStub } from './palaute-fixtures.mjs';
import { PALAUTE_PATH } from './pages.mjs';

function bootPalaute({ withExcelJS = false, stubLoadExcelJS = !withExcelJS, realTimers = false } = {}) {
  let downloads;
  let alerts;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) {
      if (realTimers) {
        // Long timers (downloadBlob's deferred revoke) are unref'd so they do
        // not hold this test process open; the short ExcelJS timeout must stay
        // ref'd because the test awaits the rejection it produces.
        sandbox.setTimeout = (fn, ms, ...args) => {
          const t = setTimeout(fn, ms, ...args);
          if (ms >= 1000) t.unref();
          return t;
        };
        sandbox.clearTimeout = clearTimeout;
      }
      alerts = captureAlerts(sandbox);
      downloads = captureDownloads(sandbox);
      if (withExcelJS) {
        sandbox.ExcelJS = createExcelJSStub({ buffer: new Uint8Array([1, 2, 3]) }).ExcelJS;
      }
    },
  });

  // Script injection is a no-op under the stub DOM, so the harness replaces
  // loadExcelJS instead of waiting on a real script load that never fires.
  if (stubLoadExcelJS) {
    run(`loadExcelJS = () => Promise.reject(new Error('ExcelJS load failed'));`);
  }

  return { run, downloads, alerts };
}

const FORMS = [
  { id: 'a', attendance: 'both', ratings: [5, 4, 3, 2, 1, null, 5], recommend: 'kylla',
    free: { best: 'Hyvä', improve: '', topics: '', open: '' }, name: 'A', phone: '111' },
];

test('exportForms falls back to JSON with three sheets when ExcelJS is unavailable', async () => {
  const { run, downloads, alerts } = bootPalaute({ withExcelJS: false });
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportForms()');

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
  const { run, downloads } = bootPalaute({ withExcelJS: false });
  run(`forms = ${JSON.stringify(FORMS)};`);
  run('exportJsonFallback()');
  assert.equal(downloads.length, 1);
  const payload = JSON.parse(downloads[0].text);
  assert.equal(payload.sheets['Vastaukset'][1][1], 'Molemmat päivät'); // attLabel
});

test('loadExcelJS times out, clears the cached promise, and lets a retry start fresh', async () => {
  const { run } = bootPalaute({ stubLoadExcelJS: false, realTimers: true });
  run('excelJsLoadTimeoutMs = 40');
  const first = run('loadExcelJS()');
  await assert.rejects(first, /timed out/i);
  assert.equal(run('excelJsLoad'), null, 'cached promise must be cleared so a retry can inject a fresh script');
  const second = run('loadExcelJS()');
  assert.notEqual(second, first);
  await assert.rejects(second, /timed out/i);
}, { timeout: 2000 });

test('exportForms falls back to JSON when the ExcelJS script hangs past the timeout', async () => {
  const { run, downloads, alerts } = bootPalaute({ stubLoadExcelJS: false, realTimers: true });
  run('excelJsLoadTimeoutMs = 40');
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportForms()');
  assert.equal(downloads.length, 1);
  assert.match(downloads[0].type, /json/i);
  assert.ok(alerts.some(a => /JSON/i.test(a)));
}, { timeout: 2000 });

test('exportForms still prefers xlsx when ExcelJS is present', async () => {
  const { run, downloads, alerts } = bootPalaute({ withExcelJS: true });
  run(`forms = ${JSON.stringify(FORMS)};`);
  await run('exportForms()');
  assert.equal(downloads.length, 1);
  // xlsx path uses ArrayBuffer → non-json mime
  assert.doesNotMatch(downloads[0].type || '', /json/i);
  assert.equal(alerts.length, 0, 'no fallback alert when Excel succeeds');
});

// The empty-store guard is the only thing standing between "nothing to export"
// and a download of an empty workbook. Removing `if (!forms.length)` used to
// pass the suite.
test('exportForms with zero forms alerts and does not download', async () => {
  const { run, downloads, alerts } = bootPalaute({ withExcelJS: true });
  run('forms = [];');
  await run('exportForms()');
  assert.equal(downloads.length, 0, 'no workbook download for an empty store');
  assert.ok(
    alerts.some(a => a.includes('Ei vielä tallennettuja lomakkeita')),
    'operator is told there is nothing to export',
  );
});

// downloadBlob is the only path that gets responses off the device. Revoking the
// object URL in the same tick as click() can fail the download silently
// (finding #9585), so the revoke must be scheduled, not run inline.
test('downloadBlob clicks the anchor and defers revokeObjectURL to a timer', () => {
  const clicks = [];
  let downloads;
  let timers;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) {
      downloads = captureDownloads(sandbox);
      ({ timers } = queueTimers(sandbox));
      captureCreated(sandbox, (el, tag) => {
        if (tag === 'a') el.click = () => clicks.push({ href: el.href, download: el.download });
      });
    },
  });
  run(`forms = ${JSON.stringify(FORMS)};`);
  run('exportJsonFallback()');

  assert.equal(downloads.length, 1);
  const [dl] = downloads;
  assert.equal(clicks.length, 1, 'the anchor is clicked synchronously');
  assert.equal(clicks[0].href, dl.url, 'the anchor points at the object URL');
  assert.match(clicks[0].download, /^palaute-huippu2026-.*\.json$/);
  assert.equal(dl.revoked, false, 'the revoke must not run in the same tick as the click');
  const revoke = timers.find(t => t.ms === run('BLOB_REVOKE_DELAY_MS'));
  assert.ok(revoke, 'the revoke is scheduled on a BLOB_REVOKE_DELAY_MS timer');
  assert.ok(run('BLOB_REVOKE_DELAY_MS') >= 10000, 'the delay leaves the download time to start');

  revoke.fn();
  assert.equal(dl.revoked, true, 'the timer revokes the same object URL');
});

// SRI wiring is independent of whether the script actually loads: dropping
// `s.integrity = EXCELJS_SRI` still produces a working export (and a green
// suite) while the page starts executing an unverified third-party script.
test('loadExcelJS pins integrity and anonymous crossOrigin on the injected script', () => {
  let created;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sandbox) { created = captureCreated(sandbox); },
  });
  run('loadExcelJS()');
  const script = created.find(c => c.tag === 'script');
  assert.ok(script, 'loadExcelJS injects a <script> element');
  assert.equal(script.el.src, run('EXCELJS_URL'));
  assert.equal(script.el.integrity, run('EXCELJS_SRI'));
  assert.match(run('EXCELJS_SRI'), /^sha512-/);
  assert.equal(script.el.crossOrigin, 'anonymous');
});

// The stub's appendChild never fires a script, so onload, onerror and the
// in-flight cache (finding #12350) never ran. Deleting onerror would leave
// an offline device waiting out the 8s timeout with these tests red.

function trackScripts(sandbox) {
  const created = captureCreated(sandbox, (el, tag) => {
    if (tag !== 'script') return;
    el.removed = false;
    el.remove = () => { el.removed = true; };
  });
  const timers = queueTimers(sandbox);
  return { created, ...timers };
}

test('loadExcelJS onerror rejects, drops the cache, and cancels the timeout', async () => {
  let tracked;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sb) { tracked = trackScripts(sb); },
  });
  const pending = run('loadExcelJS()');
  const script = tracked.created.find((c) => c.tag === 'script');
  assert.ok(script, 'a script tag was injected');
  assert.equal(tracked.timers.length, 1);

  script.el.onerror();

  await assert.rejects(pending, /failed/i);
  assert.equal(run('excelJsLoad'), null, 'a failed load must be retryable');
  assert.equal(tracked.timers.length, 0, 'the timeout must not also fire');
  assert.equal(script.el.removed, true);
});

test('loadExcelJS onload resolves and a late timeout must not drop the cache', async () => {
  let tracked;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sb) { tracked = trackScripts(sb); },
  });
  const pending = run('loadExcelJS()');
  const script = tracked.created.find((c) => c.tag === 'script');
  script.el.onload();
  await pending;
  tracked.flush();

  assert.equal(script.el.removed, false, 'a successful load keeps the script');
  assert.equal(tracked.timers.length, 0);
  assert.equal(run('excelJsLoad'), pending, 'the resolved promise stays cached');
  assert.equal(run('loadExcelJS()'), pending, 'a second call does not inject again');
  assert.equal(tracked.created.filter((c) => c.tag === 'script').length, 1);
});

test('loadExcelJS returns the same in-flight promise and injects one script', () => {
  let tracked;
  const { run } = loadPage(PALAUTE_PATH, {
    patch(sb) { tracked = trackScripts(sb); },
  });
  const first = run('loadExcelJS()');
  const second = run('loadExcelJS()');
  assert.equal(second, first);
  assert.equal(tracked.created.filter((c) => c.tag === 'script').length, 1);
});
