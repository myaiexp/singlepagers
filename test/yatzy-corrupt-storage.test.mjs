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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

const CORRUPT = '{"player1": {"id": "seat-1"'; // truncated JSON — throws on parse

// Load the page against a seeded localStorage and return both the store and a
// runner, so a test can drive a game after the load.
function loadWith(seed) {
  const { sandbox, run } = loadPage(yatzyPath, { seed });
  return { ls: sandbox.localStorage, run };
}

// Finish one game so the stats writer runs.
function playOneGame(run) {
  run(`updateGameStatistics(1, 250, 200, true, false, false, false);`);
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
    'derived names view must be written to the recovery copy');
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
