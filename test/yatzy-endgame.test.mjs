// endGame winner derivation (finding #8957): updateGameStatistics is well
// tested with a literal winner, but nothing mapped a pair of filled scorecards
// through the real endGame() comparison onto wins/losses/draws. Flipping
// `p1Total > p2Total` to `<` used to pass the whole suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';
import { scorecardTotalling } from './yatzy-fixtures.mjs';

// One element per id with a recording classList, so endGame's write to
// #winnerText (and #gameOver's `show` class) is readable afterwards.
function loadGame() {
  let elements;
  const { run, sandbox } = loadPage(YATZY_PATH, {
    patch(sb) { elements = stableElements(sb, { recordClasses: true }); },
  });
  return { run, sandbox, elements };
}

function wld(stats) {
  return [stats.wins, stats.losses, stats.draws];
}

function playToEnd(p1Lower, p2Lower) {
  const game = loadGame();
  // upper=0 on both sides: no bonus, grand total === lower.
  game.run(
    `players = { player1: { id: 'seat-1', name: 'Alice' }, player2: { id: 'seat-2', name: 'Bob' } };
     player1Scores = ${JSON.stringify(scorecardTotalling(game.run, 0, p1Lower))};
     player2Scores = ${JSON.stringify(scorecardTotalling(game.run, 0, p2Lower))};
     currentGameRolls = { 1: 13, 2: 11 };
     endGame();`,
  );
  return {
    gameOverShown: game.elements.get('gameOver').classList.contains('show'),
    p1: game.run(`getPlayerStats('seat-1')`),
    p2: game.run(`getPlayerStats('seat-2')`),
    winnerText: game.elements.get('winnerText').innerHTML,
  };
}

const cases = [
  {
    name: 'player 1 ahead',
    p1Lower: 100, p2Lower: 50,
    p1: [1, 0, 0], p2: [0, 1, 0],
    text: /Alice Wins!.*100 - 50/s,
  },
  {
    name: 'player 2 ahead',
    p1Lower: 50, p2Lower: 100,
    p1: [0, 1, 0], p2: [1, 0, 0],
    text: /Bob Wins!.*100 - 50/s,
  },
  {
    name: 'exact tie',
    p1Lower: 80, p2Lower: 80,
    p1: [0, 0, 1], p2: [0, 0, 1],
    text: /It's a Tie!.*80 - 80/s,
  },
];

for (const c of cases) {
  test(`endGame records ${c.name} from the scorecards`, () => {
    const { p1, p2, winnerText, gameOverShown } = playToEnd(c.p1Lower, c.p2Lower);
    assert.deepEqual(wld(p1), c.p1, `Alice W-L-D for ${c.name}`);
    assert.deepEqual(wld(p2), c.p2, `Bob W-L-D for ${c.name}`);
    assert.match(winnerText, c.text);
    assert.equal(gameOverShown, true, 'the game-over overlay is shown');
    // finding #9577: each seat is credited with its own rolls.
    assert.equal(p1.totalRolls, 13);
    assert.equal(p2.totalRolls, 11);
  });
}
