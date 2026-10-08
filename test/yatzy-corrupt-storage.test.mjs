// Corrupt-store tests (idea #3869): a localStorage blob that fails to parse is
// still the only copy of that data, so nothing may overwrite it. yatzy.html used
// to swallow the parse error, continue with an empty value, and then have the
// next save clobber the unreadable blob — losing player statistics and seat ids
// for good. Sibling of the palaute finding fixed in 84d38f7; same remedy, so the
// diverted writes land under "<key>_recovery" and are read back on the next load.
//
// Same no-deps node:vm + stub-DOM harness as the other yatzy tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

const CORRUPT = '{"player1": {"id": "seat-1"'; // truncated JSON — throws on parse

// Load the page against a seeded localStorage and return both the store and a
// runner, so a test can drive a game after the load.
function loadWith(seed) {
  const { sandbox, run } = loadPage(YATZY_PATH, { seed });
  return { ls: sandbox.localStorage, run };
}

// Finish one game so the stats writer runs.
function playOneGame(run) {
  run(`updateGameStatistics(1,
         { score: 250, bonus: true, yatzy: false, rolls: 13 },
         { score: 200, bonus: false, yatzy: false, rolls: 13 });`);
}

// --- yatzy_statistics --------------------------------------------------------

test('a corrupt statistics blob is never overwritten by a later save', () => {
  const { ls, run } = loadWith({ yatzy_statistics: CORRUPT });
  playOneGame(run);
  assert.equal(ls.getItem('yatzy_statistics'), CORRUPT,
    'the unreadable statistics blob must survive intact');
});

test('stats written while the store is unreadable go to the recovery key', () => {
  const { ls, run } = loadWith({ yatzy_statistics: CORRUPT });
  playOneGame(run);
  const recovered = JSON.parse(ls.getItem('yatzy_statistics_recovery') || 'null');
  assert.ok(recovered, 'new statistics were written to a recovery copy');
  assert.equal(Object.values(recovered).filter(s => s.gamesPlayed === 1).length, 2,
    'both seats recorded the game in the recovery copy');
});

test('a statistics blob that parses to a non-object is treated as unreadable', () => {
  const { ls, run } = loadWith({ yatzy_statistics: '[1,2,3]' });
  playOneGame(run);
  assert.equal(ls.getItem('yatzy_statistics'), '[1,2,3]',
    'a wrong-shaped statistics blob must not be clobbered either');
  assert.ok(ls.getItem('yatzy_statistics_recovery'), 'new stats diverted to recovery');
});

test('the recovery copy is read back on the next load, so counters accumulate', () => {
  const first = loadWith({ yatzy_statistics: CORRUPT });
  playOneGame(first.run);
  const second = loadWith({
    yatzy_statistics: CORRUPT,
    yatzy_statistics_recovery: first.ls.getItem('yatzy_statistics_recovery'),
    yatzy_players: first.ls.getItem('yatzy_players'),
  });
  playOneGame(second.run);
  const recovered = JSON.parse(second.ls.getItem('yatzy_statistics_recovery'));
  const seat = Object.values(recovered).find(s => s.gamesPlayed === 2);
  assert.ok(seat, 'the second game accumulated onto the recovered counters');
});

// --- yatzy_players -----------------------------------------------------------

test('a corrupt players blob is never overwritten on load', () => {
  const { ls } = loadWith({ yatzy_players: CORRUPT });
  assert.equal(ls.getItem('yatzy_players'), CORRUPT,
    'the unreadable seat blob must survive intact');
  const recovered = JSON.parse(ls.getItem('yatzy_players_recovery') || 'null');
  assert.ok(recovered?.player1?.id, 'fresh seats were written to a recovery copy');
});

test('seat ids stay stable across reloads while the players blob is corrupt', () => {
  const first = loadWith({ yatzy_players: CORRUPT });
  const seats1 = JSON.parse(first.ls.getItem('yatzy_players_recovery'));
  const second = loadWith({
    yatzy_players: CORRUPT,
    yatzy_players_recovery: first.ls.getItem('yatzy_players_recovery'),
  });
  const seats2 = JSON.parse(second.ls.getItem('yatzy_players_recovery'));
  assert.equal(seats2.player1.id, seats1.player1.id,
    'a corrupt canonical blob must not fork a new seat id on every reload');
  assert.equal(seats2.player2.id, seats1.player2.id);
});

// --- yatzy_playerNames (legacy source) --------------------------------------

test('a corrupt legacy names blob is not destroyed while it is the only name copy', () => {
  const { ls } = loadWith({ yatzy_playerNames: '{"player1": "Ali' });
  assert.equal(ls.getItem('yatzy_playerNames'), '{"player1": "Ali',
    'the unreadable legacy names blob must survive intact');
  const recovered = JSON.parse(ls.getItem('yatzy_playerNames_recovery') || 'null');
  assert.equal(recovered?.player1, 'Player 1',
    'the names blob built from the seats must be written to the recovery copy');
  assert.equal(recovered?.player2, 'Player 2');
  const seats = JSON.parse(ls.getItem('yatzy_players') || 'null');
  assert.ok(seats?.player1?.id, 'fresh seat ids must be minted on the canonical players key');
  assert.ok(seats?.player2?.id);
  assert.notEqual(seats.player1.id, seats.player2.id);
});

// --- the healthy path must be unaffected -------------------------------------

test('a readable store is still written in place, with no recovery copy', () => {
  const { ls, run } = loadWith({
    yatzy_playerNames: JSON.stringify({ player1: 'Alice', player2: 'Bob' }),
  });
  playOneGame(run);
  assert.ok(JSON.parse(ls.getItem('yatzy_statistics') || 'null'),
    'stats are written to the canonical key when nothing is corrupt');
  assert.equal(ls.getItem('yatzy_statistics_recovery'), null);
  assert.equal(ls.getItem('yatzy_players_recovery'), null);
});

// --- reset must wipe the recovery copy (finding #8959) ----------------------
// createSandbox's confirm() returns false, so a test has to patch it — same
// confirmCtl pattern as palaute-save.test.mjs.

test('confirmResetStats clears both stats keys and returns writes to the canonical store', () => {
  const confirmCtl = { value: false };
  const { sandbox, run } = loadPage(YATZY_PATH, {
    seed: { yatzy_statistics: CORRUPT },
    patch(s) { s.confirm = () => confirmCtl.value; },
  });
  const ls = sandbox.localStorage;
  playOneGame(run);
  assert.equal(ls.getItem('yatzy_statistics'), CORRUPT);
  assert.ok(ls.getItem('yatzy_statistics_recovery'), 'game diverted to recovery');

  confirmCtl.value = false;
  run('confirmResetStats()');
  assert.equal(ls.getItem('yatzy_statistics'), CORRUPT,
    'declining the confirm must not touch the unreadable blob');
  assert.ok(ls.getItem('yatzy_statistics_recovery'),
    'declining the confirm must not drop the recovery copy');

  confirmCtl.value = true;
  run('confirmResetStats()');
  assert.equal(ls.getItem('yatzy_statistics'), null);
  assert.equal(ls.getItem('yatzy_statistics_recovery'), null);
  assert.equal(run('unreadableStores.has(STATS_KEY)'), false,
    'the store must be readable again so later writes go to the canonical key');

  playOneGame(run);
  assert.ok(JSON.parse(ls.getItem('yatzy_statistics') || 'null'),
    'the next game must land on yatzy_statistics, not the recovery sibling');
  assert.equal(ls.getItem('yatzy_statistics_recovery'), null);
});

// finding #12346: migrateLegacyNameKeyedStats keeps non-object rows on purpose.
// renderStatistics used to throw on the null (`stats.name`) and interpolate a
// string counter straight into innerHTML. stableElements so the write is readable.
function loadRenderable() {
  const { run } = loadPage(YATZY_PATH, {
    patch(sb) { stableElements(sb); },
  });
  return { run };
}

const ROW = {
  losses: 0, draws: 0, totalRolls: 10, totalPoints: 100, yatzysScored: 0, bonusCount: 0,
};

test('renderStatistics skips non-object rows and does not treat a string counter as HTML', () => {
  const { run } = loadRenderable();
  const stored = {
    'orphan-1': {
      ...ROW,
      name: '<b>Nimi</b>',
      gamesPlayed: '<img src=x onerror=1>',
      wins: 2,
      highestScore: '<img src=x onerror=1>',
    },
    'ghost-null': null,
    'num-row-99': 5,
    '<i>orphan</i>': {
      ...ROW,
      name: '',
      gamesPlayed: 3,
      wins: 1,
      losses: 1,
      draws: 1,
      totalRolls: 9,
      highestScore: 50,
      totalPoints: 90,
    },
  };
  run(`saveAllStats(${JSON.stringify(stored)}); migrateLegacyNameKeyedStats(players);`);
  const bag = JSON.parse(run('JSON.stringify(loadAllStats())'));
  assert.equal(bag['ghost-null'], null, 'migration keeps a null row');
  assert.equal(bag['num-row-99'], 5, 'migration keeps a number row');

  assert.doesNotThrow(() => run('renderStatistics()'));
  const html = run('document.getElementById("statsContent").innerHTML');
  assert.match(html, /&lt;b&gt;Nimi/, 'an unseated stored name is escaped');
  assert.match(html, /&lt;i&gt;orphan/, 'a missing name falls back to the key, escaped');
  assert.match(html, />2</, 'a real win count is still shown');
  assert.match(html, />3</, 'a numeric gamesPlayed is still shown');
  assert.match(html, />100</);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onerror/);
  assert.doesNotMatch(html, /ghost-null/);
  assert.doesNotMatch(html, /num-row-99/);
});

test('renderStatistics shows the empty state when every stored row is non-object', () => {
  const { run } = loadRenderable();
  run('saveAllStats({ Ghost: null, Num: 5 });');
  assert.doesNotThrow(() => run('renderStatistics()'));
  const html = run('document.getElementById("statsContent").innerHTML');
  assert.match(html, /No statistics available yet/);
  assert.doesNotMatch(html, /stat-card/);
});
