// Smoke test (audit #1372): loading yatzy.html must NOT wipe persisted
// player names / statistics. The original bug ran two unconditional
// localStorage.removeItem() calls at the top of the page script, erasing both
// keys on every page load and making the Statistics modal effectively useless.
//
// After audit #2963, seats live under yatzy_players (id + name) and stats are
// keyed by seat id. Legacy yatzy_playerNames + name-keyed stats are migrated
// once on load — so "survive" means names/stat counters still present, not
// that the raw storage blob is byte-identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

// Run the page's real <script> against the no-deps DOM stub, then return the
// resulting localStorage. Any late DOM-stub miss is tolerated: loadPlayerNames
// (and stats migration) runs early in init(), so persistence is fixed by the
// time control returns here.
function simulateLoad(seed) {
  const { sandbox } = loadPage(yatzyPath, { seed });
  return sandbox.localStorage;
}

const NAMES = JSON.stringify({ player1: 'Alice', player2: 'Bob' });
const STATS = JSON.stringify({ Alice: { gamesPlayed: 3, wins: 2, totalPoints: 540 } });

test('player names survive a page load', () => {
  const ls = simulateLoad({ yatzy_playerNames: NAMES, yatzy_statistics: STATS });
  // Legacy key kept in sync; new yatzy_players holds id + name
  const legacy = JSON.parse(ls.getItem('yatzy_playerNames') || 'null');
  assert.equal(legacy?.player1, 'Alice', 'yatzy_playerNames was wiped on load');
  assert.equal(legacy?.player2, 'Bob', 'yatzy_playerNames was wiped on load');
  const seats = JSON.parse(ls.getItem('yatzy_players') || 'null');
  assert.ok(seats?.player1?.id, 'seat ids assigned on load');
  assert.equal(seats.player1.name, 'Alice');
  assert.equal(seats.player2.name, 'Bob');
});

test('statistics survive a page load (migrated under seat ids)', () => {
  const ls = simulateLoad({ yatzy_playerNames: NAMES, yatzy_statistics: STATS });
  const raw = ls.getItem('yatzy_statistics');
  assert.ok(raw, 'yatzy_statistics was wiped on load');
  const stats = JSON.parse(raw);
  // Alice's counters must still exist under some key (her seat id after migration)
  const alice = Object.values(stats).find(s => s.name === 'Alice' || s.gamesPlayed === 3);
  assert.ok(alice, 'Alice stats row still present after migration');
  assert.equal(alice.gamesPlayed, 3);
  assert.equal(alice.wins, 2);
  // Must not remain under the legacy name key
  assert.equal(stats.Alice, undefined);
});

test('stable seat ids survive a second page load', () => {
  const ls1 = simulateLoad({ yatzy_playerNames: NAMES, yatzy_statistics: STATS });
  const seats1 = JSON.parse(ls1.getItem('yatzy_players'));
  // Seed the second load with what the first load wrote
  const ls2 = simulateLoad({
    yatzy_players: ls1.getItem('yatzy_players'),
    yatzy_playerNames: ls1.getItem('yatzy_playerNames'),
    yatzy_statistics: ls1.getItem('yatzy_statistics'),
  });
  const seats2 = JSON.parse(ls2.getItem('yatzy_players'));
  assert.equal(seats2.player1.id, seats1.player1.id);
  assert.equal(seats2.player2.id, seats1.player2.id);
});
