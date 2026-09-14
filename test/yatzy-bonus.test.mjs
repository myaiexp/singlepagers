// Upper-bonus rule tests (idea #1602): the ">=63 scores 50" rule had three
// independent copies in yatzy.html — renderScorecard (what the player sees),
// calculateGrandTotal (the number that decides win/loss) and endGame (the
// bonusCount statistic). They could drift silently. These tests pin every
// consumer to one shared bonusFor() helper, checked at the 62/63 boundary.
//
// Same no-deps node:vm + stub-DOM harness as the other yatzy tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, stableElements } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';
import { scorecardTotalling } from './yatzy-fixtures.mjs';

// One element per id, so renderScorecard's innerHTML write is readable afterwards.
function loadGame() {
  let elements;
  const { run, sandbox } = loadPage(YATZY_PATH, {
    patch(sb) { elements = stableElements(sb); },
  });
  return { run, sandbox, elements };
}

const bonusFor = ({ run }, upperTotal) => run(`bonusFor(${upperTotal});`);

// --- the shared rule --------------------------------------------------------

test('bonusFor awards 50 from 63 upward and nothing below', () => {
  const game = loadGame();
  assert.equal(bonusFor(game, 0), 0);
  assert.equal(bonusFor(game, 62), 0);
  assert.equal(bonusFor(game, 63), 50);
  assert.equal(bonusFor(game, 64), 50);
  assert.equal(bonusFor(game, 105), 50);
});

// --- consumer 1: the rendered scorecard -------------------------------------

// Pull the bonus row's value out of the rendered scorecard HTML.
function renderedBonus(game, upper, lower) {
  game.run(`player1Scores = ${JSON.stringify(scorecardTotalling(game.run, upper, lower))};
            currentPlayer = 2; hasRolled = false;
            renderScorecard(1, false);`);
  const html = game.elements.get('scorecardBody1').innerHTML;
  const m = html.match(/bonus-row[\s\S]*?score-value">(\d+)</);
  assert.ok(m, 'rendered scorecard has a bonus row with a numeric value');
  return Number(m[1]);
}

test('rendered scorecard shows the shared bonus at the 62/63 boundary', () => {
  const game = loadGame();
  assert.equal(renderedBonus(game, 62, 10), bonusFor(game, 62));
  assert.equal(renderedBonus(game, 63, 10), bonusFor(game, 63));
});

// --- consumer 2: the grand total that decides the winner --------------------

test('calculateGrandTotal adds exactly the shared bonus', () => {
  const game = loadGame();
  for (const upper of [62, 63]) {
    const total = game.run(
      `calculateGrandTotal(${JSON.stringify(scorecardTotalling(game.run, upper, 10))});`,
    );
    assert.equal(total - upper - 10, bonusFor(game, upper));
  }
});

// --- consumer 3: the bonusCount statistic -----------------------------------

// Play one finished game with player 1 on the given upper total, then read back
// player 1's recorded bonusCount.
function recordedBonusCount(game, upper) {
  game.run(
    `players = { player1: { id: 'seat-1', name: 'Alice' }, player2: { id: 'seat-2', name: 'Bob' } };
     player1Scores = ${JSON.stringify(scorecardTotalling(game.run, upper, 10))};
     player2Scores = ${JSON.stringify(scorecardTotalling(game.run, 0, 0))};
     currentGameRolls = { 1: 13, 2: 13 };
     endGame();`,
  );
  return game.run(`getPlayerStats('seat-1').bonusCount;`);
}

test('endGame records a bonus exactly when the shared rule grants one', () => {
  assert.equal(recordedBonusCount(loadGame(), 62), bonusFor(loadGame(), 62) > 0 ? 1 : 0);
  assert.equal(recordedBonusCount(loadGame(), 63), bonusFor(loadGame(), 63) > 0 ? 1 : 0);
});

// --- consumer 4: the static reference card -----------------------------------

// The "Bonus Target" tile in the rules panel is static markup, deliberately kept
// out of the JS so the page still reads correctly before the script runs. That
// makes it a fourth copy of the rule, so this guard fails if the constants move
// without the card being updated to match.
test('the reference card quotes the same threshold and award as the constants', () => {
  const game = loadGame();
  const threshold = game.run('UPPER_BONUS_THRESHOLD;');
  const points = game.run('UPPER_BONUS_POINTS;');
  const html = readFileSync(YATZY_PATH, 'utf8');
  const card = html.match(/🎯 Bonus Target[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(card, 'rules panel still has a Bonus Target tile');
  assert.match(card[0], new RegExp(`≥${threshold} in upper section`));
  assert.match(card[0], new RegExp(`Bonus: \\+${points} points`));
});
