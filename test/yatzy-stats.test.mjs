// Stats-engine tests (audit #18/#21): updateGameStatistics / updateOnePlayerStats
// must keep wins + losses + draws == gamesPlayed so ties are accounted for, and
// must accumulate the per-player counters (rolls, points, highest, bonus, yatzy)
// correctly across games. Same no-deps node:vm + stub-DOM harness as the scoring
// tests; the stub provides a real in-memory localStorage, so getPlayerStats /
// savePlayerStats round-trip exactly as they do in the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSandbox } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

function extractScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('no <script> block found in yatzy.html');
  return m[1];
}

// Fresh sandbox per test: empty localStorage, page script loaded. init() throws
// partway under the stub (reference-panel DOM); tolerated — the stats functions
// are hoisted declarations and fully defined regardless.
function loadGame() {
  const sandbox = createSandbox({});
  vm.createContext(sandbox);
  try {
    vm.runInContext(extractScript(readFileSync(yatzyPath, 'utf8')), sandbox, {
      filename: 'yatzy.html#script',
    });
  } catch {
    // Load-time DOM-stub miss — tolerated; stats declarations are initialized.
  }
  return sandbox;
}

// Record one finished game. winner: 0 tie, 1 player1, 2 player2.
function playGame(sandbox, { winner, p1Score, p2Score, p1Bonus = false, p2Bonus = false, p1Yatzy = false, p2Yatzy = false, rolls = 13 }) {
  vm.runInContext(
    `playerNames = { player1: 'Alice', player2: 'Bob' };
     currentGameRolls = ${rolls};
     updateGameStatistics(${winner}, ${p1Score}, ${p2Score}, ${p1Bonus}, ${p2Bonus}, ${p1Yatzy}, ${p2Yatzy});`,
    sandbox,
  );
}
const statsOf = (sandbox, name) => vm.runInContext(`getPlayerStats(${JSON.stringify(name)});`, sandbox);

test('a decisive game records one win and one loss', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 200, p2Score: 150 });
  const a = statsOf(s, 'Alice');
  const b = statsOf(s, 'Bob');
  assert.deepEqual([a.wins, a.losses, a.draws, a.gamesPlayed], [1, 0, 0, 1]);
  assert.deepEqual([b.wins, b.losses, b.draws, b.gamesPlayed], [0, 1, 0, 1]);
});

test('a tie records a draw for both players, not a win or loss', () => {
  const s = loadGame();
  playGame(s, { winner: 0, p1Score: 175, p2Score: 175 });
  for (const name of ['Alice', 'Bob']) {
    const st = statsOf(s, name);
    assert.deepEqual([st.wins, st.losses, st.draws, st.gamesPlayed], [0, 0, 1, 1], name);
  }
});

test('wins + losses + draws equals gamesPlayed across mixed results', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 200, p2Score: 150 }); // Alice win
  playGame(s, { winner: 2, p1Score: 120, p2Score: 180 }); // Alice loss
  playGame(s, { winner: 0, p1Score: 160, p2Score: 160 }); // tie
  const a = statsOf(s, 'Alice');
  assert.deepEqual([a.wins, a.losses, a.draws], [1, 1, 1]);
  assert.equal(a.wins + a.losses + a.draws, a.gamesPlayed);
  assert.equal(a.gamesPlayed, 3);
});

test('per-player accumulators track rolls, points, highest, bonus, yatzy', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 100, p2Score: 90, p1Bonus: true, p1Yatzy: true, rolls: 10 });
  playGame(s, { winner: 2, p1Score: 250, p2Score: 300, rolls: 12 });
  const a = statsOf(s, 'Alice');
  assert.equal(a.totalRolls, 22);
  assert.equal(a.totalPoints, 350);
  assert.equal(a.highestScore, 250); // max of 100 and 250, not the latest
  assert.equal(a.bonusCount, 1);
  assert.equal(a.yatzysScored, 1);
});
