// Label-helper tests (audit #1871): prove palaute.html's attLabel/recLabel return
// the expected attendance/recommend mappings, AND that renderReview is routed
// through those helpers rather than reimplementing the lookup inline.
//
// Same no-deps approach as yatzy-scoring.test.mjs: the page's real <script> runs
// under node:vm against the stub DOM, with ZERO changes to palaute.html. attLabel,
// recLabel and renderReview are top-level function declarations (hoisted); reviewEl
// is a top-level `const` and forms a top-level `let` — all reachable from later
// runInContext() calls in the same realm. The boot code (renderEntry/updateCount)
// may touch DOM the stub doesn't fully model and throw, but every declaration these
// tests use is initialized before that point, so the throw is irrelevant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSandbox } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');

// Grab the inline <script> (the ExcelJS CDN tag has a `src` attr, so `<script>`
// with an immediate `>` only matches the page's own code block).
function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no inline <script> block found in palaute.html');
  return m[1];
}

const sandbox = createSandbox({});
vm.createContext(sandbox);
try {
  vm.runInContext(extractScript(readFileSync(palautePath, 'utf8')), sandbox, {
    filename: 'palaute.html#script',
  });
} catch {
  // Load-time DOM-stub miss in boot — tolerated; the decls below are initialized.
}

const run = (code) => vm.runInContext(code, sandbox);

// --- attLabel / recLabel: the mapping itself --------------------------------

test('attLabel maps each attendance value to its Finnish label', () => {
  assert.equal(run('attLabel("both")'), 'Molemmat päivät');
  assert.equal(run('attLabel("thu")'), 'Torstai');
  assert.equal(run('attLabel("fri")'), 'Perjantai');
});

test('recLabel maps each recommend value to its Finnish label', () => {
  assert.equal(run('recLabel("kylla")'), 'Kyllä');
  assert.equal(run('recLabel("ehka")'), 'Ehkä');
  assert.equal(run('recLabel("en")'), 'En');
});

test('attLabel / recLabel return "" for unknown or null values', () => {
  // The export path relies on this empty-string fallback (blank Excel cell);
  // renderReview layers its own "—" on top via `attLabel(v) || "—"`.
  assert.equal(run('attLabel("bogus")'), '');
  assert.equal(run('attLabel(null)'), '');
  assert.equal(run('recLabel("bogus")'), '');
  assert.equal(run('recLabel(null)'), '');
});

// --- renderReview is genuinely routed through the helpers --------------------

// Mutation proof: swap attLabel/recLabel for sentinels and confirm renderReview's
// output reflects them. If renderReview still did the inline ATTENDANCE/RECOMMEND
// lookup (the pre-#1871 duplication), it would emit the real labels instead and
// these assertions would fail. Originals are restored so other tests are unaffected.
test('renderReview emits whatever attLabel/recLabel return (routed, not inline)', () => {
  const form = {
    id: 'x', attendance: 'both', ratings: [3, 4, null, 5, 2, 1, 3],
    recommend: 'kylla', free: { best: 'hyvä', improve: '', topics: '', open: '' },
    name: '', phone: '',
  };
  run(`forms = [${JSON.stringify(form)}];`);
  run('__origAtt = attLabel; __origRec = recLabel;');
  run('attLabel = () => "ATT_SENTINEL"; recLabel = () => "REC_SENTINEL";');
  try {
    run('renderReview();');
    const html = run('reviewEl.innerHTML');
    assert.match(html, /ATT_SENTINEL/);
    assert.match(html, /REC_SENTINEL/);
    // The real labels must NOT appear — that would mean an inline lookup leaked through.
    assert.doesNotMatch(html, /Molemmat päivät/);
    assert.doesNotMatch(html, /Kyllä/);
  } finally {
    run('attLabel = __origAtt; recLabel = __origRec;');
  }
});

// With the real helpers, the "—" fallback for an unrecognised attendance value
// is supplied at the renderReview call site, not by the helper.
test('renderReview falls back to "—" for an unrecognised attendance/recommend', () => {
  const form = {
    id: 'y', attendance: 'nope', ratings: [null, null, null, null, null, null, null],
    recommend: 'nope', free: { best: '', improve: '', topics: '', open: '' },
    name: '', phone: '',
  };
  run(`forms = [${JSON.stringify(form)}];`);
  run('renderReview();');
  const html = run('reviewEl.innerHTML');
  assert.match(html, /—/);
});
