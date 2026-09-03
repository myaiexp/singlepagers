// endGame winner derivation (finding #8957): updateGameStatistics is well
// tested with a literal winner, but nothing mapped a pair of filled scorecards
// through the real endGame() comparison onto wins/losses/draws. Flipping
// `p1Total > p2Total` to `<` used to pass the whole suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage, createDocument } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

// Same identity-preserving getElementById as yatzy-bonus.test.mjs so
// endGame's write to #winnerText is readable afterwards.
function loadGame() {
  const elements = new Map();
  const { run, sandbox } = loadPage(yatzyPath, {
    patch(sb) {
      const doc = createDocument();
      sb.document = {
        ...doc,
        getElementById(id) {
          if (!elements.has(id)) elements.set(id, doc.getElementById(id));
          return elements.get(id);
        },
      };
    },
  });
  return { run, sandbox, elements };
}

// Upper section totals `upper`, lower `lower`. Rest of the rows are filled
// with 0 so isGameOver-style completeness is irrelevant — endGame reads totals.
function scorecardTotalling(upper, lower) {
  const row = (id, value) => ({ id, name: id, value });
  return {
    upper: [row('ones', upper), row('twos', 0), row('threes', 0),
      row('fours', 0), row('fives', 0), row('sixes', 0)],
    lower: [row('threeOfAKind', lower), row('fourOfAKind', 0), row('fullHouse', 0),
      row('smallStraight', 0), row('largeStraight', 0), row('yatzy', 0), row('chance', 0)],
  };
}

function wld(stats) {
  return [stats.wins, stats.losses, stats.draws];
}

function playToEnd(p1Lower, p2Lower) {
  const game = loadGame();
  // upper=0 on both sides: no bonus, grand total === lower.
  game.run(
    `players = { player1: { id: 'seat-1', name: 'Alice' }, player2: { id: 'seat-2', name: 'Bob' } };
     playerNames = { player1: 'Alice', player2: 'Bob' };
     player1Scores = ${JSON.stringify(scorecardTotalling(0, p1Lower))};
     player2Scores = ${JSON.stringify(scorecardTotalling(0, p2Lower))};
     currentGameRolls = 13;
     endGame();`,
  );
  return {
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
    const { p1, p2, winnerText } = playToEnd(c.p1Lower, c.p2Lower);
    assert.deepEqual(wld(p1), c.p1, `Alice W-L-D for ${c.name}`);
    assert.deepEqual(wld(p2), c.p2, `Bob W-L-D for ${c.name}`);
    assert.match(winnerText, c.text);
  });
}
