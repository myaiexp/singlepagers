// Keyboard-cursor tests (audit #1379): prove palaute.html's entry cursor keeps the
// rating-row index as a genuine number throughout, never a string re-parsed from a
// sentinel like "r0". The cursor is the tagged union
//   { section:"attendance" } | { section:"rating", row:<0..6 number> } | { section:"recommend" } | null
//
// Same no-deps approach as palaute-labels.test.mjs: loadPage runs the page's
// real <script> under node:vm against the stub DOM with ZERO changes to
// palaute.html. cursor is a top-level `let`; routeNumberKey, setRating and
// current/forms are reachable from later run() calls in the same realm.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const { run } = loadPage(PALAUTE_PATH);
const reset = () => run('current = blankForm(); cursor = { section: "attendance" };');

// --- The index is numeric at every step, not a parsed string -----------------

test('routeNumberKey moves att -> rating(row 0) with a numeric row', () => {
  reset();
  run('routeNumberKey(1)'); // choose first attendance option
  assert.equal(run('current.attendance'), 'both');
  assert.equal(run('cursor.section'), 'rating');
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
  run('cursor = { section: "rating", row: 3 };');
  run('setRating(3, 4)');
  assert.equal(run('current.ratings[3]'), 4);
  assert.equal(run('cursor.row'), 4); // advanced to next row
  assert.equal(run('typeof cursor.row'), 'number');
});

test('setRating on the last row hands off to recommend (no row carried)', () => {
  reset();
  const last = run('RATING_ITEMS.length - 1'); // 6
  run(`cursor = { section: "rating", row: ${last} };`);
  run(`setRating(${last}, 5)`);
  assert.equal(run(`current.ratings[${last}]`), 5);
  assert.equal(run('cursor.section'), 'recommend');
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
    assert.equal(run('cursor == null || typeof cursor.row !== "string"'), true);
    if (run('cursor && cursor.section === "rating"')) {
      assert.equal(run('typeof cursor.row'), 'number');
    }
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
  assert.equal(run('cursor.section'), 'attendance'); // stays put
});
