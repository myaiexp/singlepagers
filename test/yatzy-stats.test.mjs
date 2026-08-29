// Stats-engine tests (audit #18/#21/#2963): updateGameStatistics / updateOnePlayerStats
// must keep wins + losses + draws == gamesPlayed so ties are accounted for, accumulate
// per-player counters correctly, and key stats by stable seat id so a mid-game name
// change does not fork a new entry. Same no-deps node:vm + stub-DOM harness as the
// scoring tests; the stub provides a real in-memory localStorage, so getPlayerStats /
// savePlayerStats round-trip exactly as they do in the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

// Fresh sandbox per test: empty localStorage, page script loaded. init() throws
// partway under the stub (reference-panel DOM); tolerated — the stats functions
// are hoisted declarations and fully defined regardless. After load, seat ids
// exist (loadPlayerNames ran during init or we seed them).
function loadGame() {
  const { run } = loadPage(yatzyPath);
  // Ensure seats have stable ids + known names (init may have partially run)
  run(
    `players = {
       player1: { id: players?.player1?.id || newPlayerId(), name: 'Alice' },
       player2: { id: players?.player2?.id || newPlayerId(), name: 'Bob' }
     };
     syncPlayerNamesView();
     savePlayersToStorage();`,
  );
  return { run };
}

// Record one finished game. winner: 0 tie, 1 player1, 2 player2.
function playGame({ run }, { winner, p1Score, p2Score, p1Bonus = false, p2Bonus = false, p1Yatzy = false, p2Yatzy = false, rolls = 13 }) {
  run(
    `currentGameRolls = ${rolls};
     updateGameStatistics(${winner}, ${p1Score}, ${p2Score}, ${p1Bonus}, ${p2Bonus}, ${p1Yatzy}, ${p2Yatzy});`,
  );
}

const seatId = ({ run }, slot) =>
  run(`players.${slot}.id;`);

const statsOfId = ({ run }, id) =>
  run(`getPlayerStats(${JSON.stringify(id)});`);

const allStats = ({ run }) =>
  JSON.parse(run(`JSON.stringify(loadAllStats());`));

test('a decisive game records one win and one loss', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 200, p2Score: 150 });
  const a = statsOfId(s, seatId(s, 'player1'));
  const b = statsOfId(s, seatId(s, 'player2'));
  assert.deepEqual([a.wins, a.losses, a.draws, a.gamesPlayed], [1, 0, 0, 1]);
  assert.deepEqual([b.wins, b.losses, b.draws, b.gamesPlayed], [0, 1, 0, 1]);
  assert.equal(a.name, 'Alice');
  assert.equal(b.name, 'Bob');
});

test('a tie records a draw for both players, not a win or loss', () => {
  const s = loadGame();
  playGame(s, { winner: 0, p1Score: 175, p2Score: 175 });
  for (const slot of ['player1', 'player2']) {
    const st = statsOfId(s, seatId(s, slot));
    assert.deepEqual([st.wins, st.losses, st.draws, st.gamesPlayed], [0, 0, 1, 1], slot);
  }
});

test('wins + losses + draws equals gamesPlayed across mixed results', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 200, p2Score: 150 }); // Alice win
  playGame(s, { winner: 2, p1Score: 120, p2Score: 180 }); // Alice loss
  playGame(s, { winner: 0, p1Score: 160, p2Score: 160 }); // tie
  const a = statsOfId(s, seatId(s, 'player1'));
  assert.deepEqual([a.wins, a.losses, a.draws], [1, 1, 1]);
  assert.equal(a.wins + a.losses + a.draws, a.gamesPlayed);
  assert.equal(a.gamesPlayed, 3);
});

test('per-player accumulators track rolls, points, highest, bonus, yatzy', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 100, p2Score: 90, p1Bonus: true, p1Yatzy: true, rolls: 10 });
  playGame(s, { winner: 2, p1Score: 250, p2Score: 300, rolls: 12 });
  const a = statsOfId(s, seatId(s, 'player1'));
  assert.equal(a.totalRolls, 22);
  assert.equal(a.totalPoints, 350);
  assert.equal(a.highestScore, 250); // max of 100 and 250, not the latest
  assert.equal(a.bonusCount, 1);
  assert.equal(a.yatzysScored, 1);
});

// finding #2963: rename mid-game must not fork stats into a new key
test('renaming a player mid-game keeps stats under the same seat id', () => {
  const s = loadGame();
  playGame(s, { winner: 1, p1Score: 200, p2Score: 100 });
  const idBefore = seatId(s, 'player1');
  assert.equal(statsOfId(s, idBefore).gamesPlayed, 1);

  // Simulate Edit Names: only the display name changes
  s.run(
    `players.player1.name = 'Alicia';
     syncPlayerNamesView();
     savePlayersToStorage();
     const all = loadAllStats();
     if (all[players.player1.id]) {
       all[players.player1.id] = { ...all[players.player1.id], name: players.player1.name };
       saveAllStats(all);
     }`,
  );

  playGame(s, { winner: 1, p1Score: 180, p2Score: 90 });
  const idAfter = seatId(s, 'player1');
  assert.equal(idAfter, idBefore, 'seat id must be stable across rename');

  const st = statsOfId(s, idAfter);
  assert.equal(st.gamesPlayed, 2, 'second game accumulates on same entry');
  assert.equal(st.wins, 2);
  assert.equal(st.name, 'Alicia');

  // No leftover name-keyed fork under either display name
  const bag = allStats(s);
  assert.equal(bag['Alice'], undefined);
  assert.equal(bag['Alicia'], undefined);
  assert.equal(Object.keys(bag).filter(k => bag[k].gamesPlayed > 0).length, 2); // Alice seat + Bob seat
});
