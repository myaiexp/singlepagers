// Keyboard-cursor tests (audit #1379): prove palaute.html's entry cursor keeps the
// rating-row index as a genuine number throughout, never a string re-parsed from a
// sentinel like "r0". The cursor is the tagged union
//   { sec:"att" } | { sec:"rating", row:<0..6 number> } | { sec:"rec" } | null
//
// Same no-deps approach as palaute-labels.test.mjs: the page's real <script> runs
// under node:vm against the stub DOM with ZERO changes to palaute.html. cursor is a
// top-level `let`; routeNumberKey, setRating and current/forms are reachable from
// later runInContext() calls in the same realm.

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
const reset = () => run('current = blankForm(); cursor = { sec: "att" };');

// --- The index is numeric at every step, not a parsed string -----------------

test('routeNumberKey moves att -> rating(row 0) with a numeric row', () => {
  reset();
  run('routeNumberKey(1)'); // choose first attendance option
  assert.equal(run('current.attendance'), 'both');
  assert.equal(run('cursor.sec'), 'rating');
  assert.equal(run('cursor.row'), 0);
  assert.equal(run('typeof cursor.row'), 'number');
});

test('rating cursor advances by a numeric +1, never a "r"+n string', () => {
  reset();
  run('routeNumberKey(1)');       // -> rating row 0
  run('routeNumberKey(5)');       // rate row 0 = 5 -> row 1
  assert.equal(run('cursor.row'), 1);
  assert.equal(run('typeof cursor.row'), 'number');
  run('routeNumberKey(4)');       // rate row 1 = 4 -> row 2
  assert.equal(run('cursor.row'), 2);
  assert.equal(run('typeof cursor.row'), 'number');
});

test('setRating writes to the numeric row index and lands the value', () => {
  reset();
  run('cursor = { sec: "rating", row: 3 };');
  run('setRating(3, 4)');
  assert.equal(run('current.ratings[3]'), 4);
  assert.equal(run('cursor.row'), 4); // advanced to next row
  assert.equal(run('typeof cursor.row'), 'number');
});

test('setRating on the last row hands off to recommend (no row carried)', () => {
  reset();
  const last = run('RATING_ITEMS.length - 1'); // 6
  run(`cursor = { sec: "rating", row: ${last} };`);
  run(`setRating(${last}, 5)`);
  assert.equal(run(`current.ratings[${last}]`), 5);
  assert.equal(run('cursor.sec'), 'rec');
  assert.equal(run('cursor.row'), undefined);
});

// --- Full keyboard walkthrough: att -> r0..r6 -> rec -> null -----------------

test('a full number-key run lands every value in the right numeric slot', () => {
  reset();
  const presses = [1, 5, 4, 0, 3, 2, 1, 5, 1];
  // 1: attendance "both"; 5,4,0,3,2,1,5: ratings rows 0..6 (0 = skip -> null);
  // final 1: recommend "kylla".
  presses.forEach((n) => {
    run(`routeNumberKey(${n})`);
    // The cursor never holds a string-encoded row at any point in the walk.
    assert.notEqual(run('typeof cursor === "string"'), true);
  });
  // Compare via JSON: current.ratings is a cross-realm array, so strict deepEqual
  // would reject it on prototype identity alone.
  assert.equal(run('JSON.stringify(current.ratings)'), JSON.stringify([5, 4, null, 3, 2, 1, 5]));
  assert.equal(run('current.attendance'), 'both');
  assert.equal(run('current.recommend'), 'kylla');
  assert.equal(run('cursor'), null); // recommend chosen -> cursor released to free-text
});

test('number key 0 on attendance is ignored (out of 1..3 range)', () => {
  reset();
  run('routeNumberKey(0)');
  assert.equal(run('current.attendance'), null);
  assert.equal(run('cursor.sec'), 'att'); // stays put
});
