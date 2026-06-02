// dice() similarity tests (audit #1517): pin the Sørensen-Dice coefficient at
// palaute.html and CHARACTERIZE its known short-string limitation — these are
// behaviour-pinning tests, not a fix. The SUT is untouched.
//
// dice(a,b) builds character bigram multisets of norm(a)/norm(b) and returns
// 2|A∩B| / (|A|+|B|). When EITHER side has no bigrams (≤1 char after
// normalization) it falls back to exact-string-equality (1 if norm-equal else 0).
// That fallback is the part #1517 flags as uncovered, plus the quirk that two
// strings sharing a character can still score 0 (e.g. 'a' vs 'ab').
//
// Same no-deps harness as palaute-labels.test.mjs: the page's real inline <script>
// runs under node:vm against the stub DOM with ZERO changes to palaute.html. norm,
// bigrams and dice are hoisted top-level function declarations, initialized before
// the boot code that may throw against the partial DOM stub — so they're reachable
// from later runInContext() calls even though boot itself is wrapped in try/catch.

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
  // Load-time DOM-stub miss in boot — tolerated; norm/bigrams/dice are initialized.
}

const dice = (a, b) => vm.runInContext(`dice(${JSON.stringify(a)}, ${JSON.stringify(b)})`, sandbox);

// --- the empty-bigram fallback (the uncovered branch #1517 names) ------------

test("dice('','') → 1: both normalize to '', exact-equality fallback fires", () => {
  // Both inputs have <2 chars → no bigrams → fallback to norm(a)===norm(b).
  // '' === '' is true, so this returns 1 (NOT 0). Mutation-kill: deleting the
  // fallback line makes this 0/0 = NaN.
  assert.equal(dice('', ''), 1);
});

test("dice('a','a') → 1: single chars yield no bigrams, fallback sees them equal", () => {
  // Reflexive case routed entirely through the fallback (length<2, no bigrams).
  // Same mutation-kill as above: without the fallback this is NaN, not 1.
  assert.equal(dice('a', 'a'), 1);
});

// --- KNOWN LIMITATION: short strings sharing a character still score 0 -------

test("dice('a','ab') → 0: PINNED short-string limitation, NOT a desired result", () => {
  // 'a' and 'ab' visibly share the letter 'a', yet score 0. Reason: 'a' produces
  // no bigrams, so dice() abandons set-overlap and falls back to exact-string-
  // equality — and 'a' !== 'ab'. This is a real quality limitation (a unigram
  // fallback would score >0); characterized here, deliberately left unfixed.
  // Spun off as Code Quality idea C2 (unigram fallback) — out of scope for #1517.
  assert.equal(dice('a', 'ab'), 0);
});

// --- the normal bigram-overlap path -----------------------------------------

test("dice('hyvä','hyvää') → 6/7: mid-range overlap pinned exactly", () => {
  // A = {hy,yv,vä} (3 bigrams), B = {hy,yv,vä,ää} (4). |A∩B| = 3, so
  // 2*3/(3+4) = 6/7 ≈ 0.857 (> 0.5). Mutation-kill: any tweak to the
  // intersection count or the |A|+|B| denominator shifts this off 6/7.
  assert.equal(dice('hyvä', 'hyvää'), 6 / 7);
  assert.ok(dice('hyvä', 'hyvää') > 0.5);
});

test('dice(s,s) is reflexively 1 for multi-char strings', () => {
  assert.equal(dice('hyvä', 'hyvä'), 1);
  assert.equal(dice('suositus', 'suositus'), 1);
});

test("dice('cat','dog') → 0: disjoint bigram sets (a non-fallback zero)", () => {
  // Distinct from the 'a'/'ab' zero above: here both sides DO have bigrams,
  // they just share none — the genuine set-overlap path returning 0.
  assert.equal(dice('cat', 'dog'), 0);
});

// --- normalization applied by norm()/bigrams() before comparison ------------

test('dice normalizes case before comparing (Hyvä ≡ hyvä)', () => {
  assert.equal(dice('Hyvä', 'hyvä'), 1);
});

test('dice trims surrounding whitespace before comparing', () => {
  assert.equal(dice('  hyvä  ', 'hyvä'), 1);
});

test("dice strips internal whitespace when forming bigrams ('a b' ≡ 'ab')", () => {
  // bigrams() does norm(s).replace(/\s/g,'') before slicing, so the space in
  // 'a b' is removed and it forms the single bigram 'ab' — identical to 'ab'.
  assert.equal(dice('a b', 'ab'), 1);
});
