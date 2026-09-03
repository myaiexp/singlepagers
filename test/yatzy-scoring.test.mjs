// Scoring-engine tests (audit #1513): exercise yatzy.html's real scoring logic
// — calculateScore (15 category branches + default), calculateUpperTotal,
// calculateGrandTotal (the >=63 upper bonus), and isGameOver.
//
// Same no-deps approach as yatzy-load-persistence.test.mjs: loadPage runs the
// page's real <script> under node:vm against the stub DOM, with ZERO changes
// to yatzy.html. The scoring functions are top-level declarations, and
// diceValues / player1Scores / player2Scores are top-level `let` bindings —
// both reachable from later run() calls in the same realm, so we drive the
// engine by assigning the state a function reads, then calling it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

// One sandbox shared across tests: every helper fully sets the state its target
// reads before calling, so there is no cross-test leakage.
const { run } = loadPage(yatzyPath);

// Set diceValues, then score one category against the page's real calculateScore.
function scoreOf(dice, categoryId) {
  run(`diceValues = ${JSON.stringify(dice)};`);
  return run(`calculateScore(${JSON.stringify(categoryId)});`);
}

// calculateGrandTotal / calculateUpperTotal only read .upper/.lower[].value.
function scores(upperVals, lowerVals) {
  return {
    upper: upperVals.map((value) => ({ value })),
    lower: lowerVals.map((value) => ({ value })),
  };
}
const grandTotal = (s) => run(`calculateGrandTotal(${JSON.stringify(s)});`);
const upperTotal = (s) => run(`calculateUpperTotal(${JSON.stringify(s)});`);

// isGameOver reads the player1Scores / player2Scores let bindings.
function gameOver(p1, p2) {
  run(`player1Scores = ${JSON.stringify(p1)}; player2Scores = ${JSON.stringify(p2)};`);
  return run('isGameOver();');
}

// --- calculateScore: upper section (sum of matching faces) -------------------

test('upper section sums only the matching faces', () => {
  assert.equal(scoreOf([1, 1, 3, 4, 5], 'ones'), 2);
  assert.equal(scoreOf([2, 2, 2, 4, 5], 'twos'), 6);
  assert.equal(scoreOf([3, 3, 1, 1, 1], 'threes'), 6);
  assert.equal(scoreOf([4, 4, 4, 4, 1], 'fours'), 16);
  assert.equal(scoreOf([5, 5, 5, 5, 5], 'fives'), 25);
  assert.equal(scoreOf([6, 1, 2, 3, 4], 'sixes'), 6);
});

test('upper section scores 0 when the face is absent', () => {
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'sixes'), 0);
});

// --- calculateScore: pairs ---------------------------------------------------

test('onePair takes the highest pair, doubled', () => {
  assert.equal(scoreOf([3, 3, 5, 5, 1], 'onePair'), 10); // 5+5, not 3+3
  assert.equal(scoreOf([4, 4, 4, 1, 2], 'onePair'), 8); // a triple counts as a pair
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'onePair'), 0); // no pair
});

test('twoPairs sums the two highest pairs, else 0', () => {
  assert.equal(scoreOf([3, 3, 5, 5, 1], 'twoPairs'), 16); // 5*2 + 3*2
  assert.equal(scoreOf([2, 2, 2, 5, 5], 'twoPairs'), 14); // triple + pair = 5*2 + 2*2
  assert.equal(scoreOf([6, 6, 4, 4, 1], 'twoPairs'), 20);
  assert.equal(scoreOf([3, 3, 4, 5, 6], 'twoPairs'), 0); // only one pair
});

// --- calculateScore: of-a-kind ----------------------------------------------

test('threeOfKind scores face*3 (not the full hand) or 0', () => {
  assert.equal(scoreOf([4, 4, 4, 2, 1], 'threeOfKind'), 12);
  assert.equal(scoreOf([3, 3, 3, 3, 3], 'threeOfKind'), 9); // 3*3 even with five
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'threeOfKind'), 0);
});

test('fourOfKind scores face*4 or 0', () => {
  assert.equal(scoreOf([5, 5, 5, 5, 1], 'fourOfKind'), 20);
  assert.equal(scoreOf([6, 6, 6, 6, 6], 'fourOfKind'), 24); // 6*4
  assert.equal(scoreOf([3, 3, 3, 1, 2], 'fourOfKind'), 0); // only a triple
});

// --- calculateScore: straights (fixed scores, order-independent) -------------

test('smallStraight needs 1-2-3-4-5 and scores 15', () => {
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'smallStraight'), 15);
  assert.equal(scoreOf([5, 4, 3, 2, 1], 'smallStraight'), 15); // order-independent
  assert.equal(scoreOf([2, 3, 4, 5, 6], 'smallStraight'), 0); // missing 1
  assert.equal(scoreOf([1, 2, 3, 4, 4], 'smallStraight'), 0); // missing 5
});

test('largeStraight needs 2-3-4-5-6 and scores 20', () => {
  assert.equal(scoreOf([2, 3, 4, 5, 6], 'largeStraight'), 20);
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'largeStraight'), 0); // missing 6
});

// --- calculateScore: full house, chance, yatzy -------------------------------

test('fullHouse needs exactly a triple AND a pair, summed', () => {
  assert.equal(scoreOf([3, 3, 3, 2, 2], 'fullHouse'), 13);
  assert.equal(scoreOf([5, 5, 5, 1, 1], 'fullHouse'), 17);
  assert.equal(scoreOf([2, 2, 2, 2, 2], 'fullHouse'), 0); // five-of-a-kind is not a full house
  assert.equal(scoreOf([3, 3, 3, 3, 2], 'fullHouse'), 0); // four+one is not a full house
  assert.equal(scoreOf([1, 1, 2, 3, 4], 'fullHouse'), 0); // only a pair
});

test('chance sums every die', () => {
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'chance'), 15);
  assert.equal(scoreOf([6, 6, 6, 6, 6], 'chance'), 30);
});

test('yatzy scores 50 only for five of a kind', () => {
  assert.equal(scoreOf([4, 4, 4, 4, 4], 'yatzy'), 50);
  assert.equal(scoreOf([4, 4, 4, 4, 1], 'yatzy'), 0);
});

test('unknown category returns null', () => {
  assert.equal(scoreOf([1, 2, 3, 4, 5], 'bogus'), null);
});

// --- calculateUpperTotal -----------------------------------------------------

test('calculateUpperTotal sums upper values, treating null as 0', () => {
  assert.equal(upperTotal(scores([null, null, null, null, null, null], [])), 0);
  assert.equal(upperTotal(scores([1, 2, null, 4, null, 6], [])), 13);
});

// --- calculateGrandTotal (the 63-point upper bonus) --------------------------

const EMPTY_LOWER = [null, null, null, null, null, null, null, null, null];

test('calculateGrandTotal is 0 for an untouched card', () => {
  assert.equal(grandTotal(scores([null, null, null, null, null, null], EMPTY_LOWER)), 0);
});

test('upper total of exactly 63 earns the 50-point bonus', () => {
  // upper = 3+6+9+12+15+18 = 63 -> +50 bonus, no lower
  assert.equal(grandTotal(scores([3, 6, 9, 12, 15, 18], EMPTY_LOWER)), 113);
});

test('upper total of 62 earns no bonus (boundary)', () => {
  // upper = 3+6+9+12+15+17 = 62 -> no bonus
  assert.equal(grandTotal(scores([3, 6, 9, 12, 15, 17], EMPTY_LOWER)), 62);
});

test('calculateGrandTotal adds upper + lower when under the bonus threshold', () => {
  // upper = 21 (<63, no bonus), lower = 60 -> 81
  assert.equal(
    grandTotal(scores([1, 2, 3, 4, 5, 6], [10, 20, 30, null, null, null, null, null, null])),
    81,
  );
});

// --- isGameOver --------------------------------------------------------------

const FULL_UPPER = [1, 2, 3, 4, 5, 6];
const FULL_LOWER = [1, 2, 3, 4, 5, 6, 7, 8, 9];

test('isGameOver is true only when both cards are fully scored', () => {
  assert.equal(gameOver(scores(FULL_UPPER, FULL_LOWER), scores(FULL_UPPER, FULL_LOWER)), true);
});

test('isGameOver is false when player 1 has an open category', () => {
  const p1 = scores([1, 2, 3, 4, 5, null], FULL_LOWER);
  assert.equal(gameOver(p1, scores(FULL_UPPER, FULL_LOWER)), false);
});

test('isGameOver is false when player 2 has an open category', () => {
  const p2 = scores([1, 2, 3, 4, 5, null], FULL_LOWER);
  assert.equal(gameOver(scores(FULL_UPPER, FULL_LOWER), p2), false);
});
