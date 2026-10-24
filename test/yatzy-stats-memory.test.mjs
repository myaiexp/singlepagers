// In-memory statistics (idea #6710): the stats map is read from localStorage
// once and kept for the session, and one finished game is one write. When the
// stats blob and its recovery copy both failed to parse, the games just played
// used to vanish from the Statistics modal even though the alert says the
// session keeps them; and with two writes per game, a refused second write
// left a win in storage with no matching loss. Another tab's save or reset
// reaches this tab through the `storage` event, which reloads the map.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements, dispatch } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

const CORRUPT = '{"seat-1":{"gamesPlayed":'; // truncated JSON — throws on parse

function load(seed = {}) {
  const { sandbox, run, loadError } = loadPage(YATZY_PATH, {
    seed,
    patch(sb) { stableElements(sb); sb.confirm = () => true; },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  return { sandbox, ls: sandbox.localStorage, run };
}

function playOneGame(run, winner = 1) {
  run(`updateGameStatistics(${winner},
         { score: 250, bonus: true, yatzy: false, rolls: 13 },
         { score: 200, bonus: false, yatzy: false, rolls: 13 });`);
}

const seatRows = (run) => JSON.parse(run(
  'JSON.stringify([getPlayerStats(players.player1.id), getPlayerStats(players.player2.id)])'));

// Count localStorage calls on `key` made while `fn` runs.
function countCalls(ls, method, key, fn) {
  const original = ls[method];
  let n = 0;
  ls[method] = function (k, ...rest) {
    if (k === key) n++;
    return original.call(this, k, ...rest);
  };
  try { fn(); } finally { ls[method] = original; }
  return n;
}

test('games finished while both stats copies are unreadable stay in the session', () => {
  const { ls, run } = load({ yatzy_statistics: CORRUPT, yatzy_statistics_recovery: CORRUPT });
  playOneGame(run, 1);
  playOneGame(run, 2);
  const [a, b] = seatRows(run);
  assert.deepEqual([a.gamesPlayed, a.wins, a.losses], [2, 1, 1]);
  assert.deepEqual([b.gamesPlayed, b.wins, b.losses], [2, 1, 1]);
  run('renderStatistics()');
  const html = run('document.getElementById("statsContent").innerHTML');
  assert.match(html, /stat-card/, 'the modal shows the session\'s games');
  assert.equal(ls.getItem('yatzy_statistics'), CORRUPT, 'neither damaged copy is written');
  assert.equal(ls.getItem('yatzy_statistics_recovery'), CORRUPT);
});

test('one finished game is one stats write and no stats read', () => {
  const { ls, run } = load();
  playOneGame(run); // first game loads the map if nothing has yet
  const writes = countCalls(ls, 'setItem', 'yatzy_statistics', () => playOneGame(run));
  assert.equal(writes, 1, 'both seats land in a single setItem');
  const reads = countCalls(ls, 'getItem', 'yatzy_statistics', () => playOneGame(run));
  assert.equal(reads, 0, 'the session map is used, not re-read from storage');
});

test('a refused stats write leaves storage with neither seat\'s game, and memory with both', () => {
  const { ls, run } = load();
  playOneGame(run, 1);
  const before = ls.getItem('yatzy_statistics');
  const original = ls.setItem;
  ls.setItem = function (k, v) {
    if (k === 'yatzy_statistics') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    return original.call(this, k, v);
  };
  playOneGame(run, 1);
  ls.setItem = original;
  assert.equal(ls.getItem('yatzy_statistics'), before, 'no half-recorded game in storage');
  const [a, b] = seatRows(run);
  assert.deepEqual([a.gamesPlayed, a.wins, b.gamesPlayed, b.losses], [2, 2, 2, 2]);
});

test('another tab\'s saved game is reloaded before this tab records the next one', () => {
  const { ls, run } = load();
  playOneGame(run, 1);
  const stored = JSON.parse(ls.getItem('yatzy_statistics'));
  const id1 = run('players.player1.id');
  stored[id1] = { ...stored[id1], gamesPlayed: 5, wins: 5 };
  ls.setItem('yatzy_statistics', JSON.stringify(stored));
  dispatch(run('window'), 'storage', { key: 'yatzy_statistics' });
  playOneGame(run, 1);
  assert.equal(JSON.parse(ls.getItem('yatzy_statistics'))[id1].gamesPlayed, 6,
    'this tab adds onto the other tab\'s counters instead of writing over them');
});

test('a storage event for an unrelated key does not reload the map', () => {
  const { ls, run } = load();
  playOneGame(run, 1);
  const reads = countCalls(ls, 'getItem', 'yatzy_statistics',
    () => dispatch(run('window'), 'storage', { key: 'palaute_huippu2026_v1' }));
  assert.equal(reads, 0);
});

test('another tab\'s reset empties this tab\'s map and returns writes to the canonical key', () => {
  const { ls, run } = load({ yatzy_statistics: CORRUPT, yatzy_statistics_recovery: CORRUPT });
  playOneGame(run, 1);
  ls.removeItem('yatzy_statistics');
  ls.removeItem('yatzy_statistics_recovery');
  dispatch(run('window'), 'storage', { key: null }); // localStorage.clear() in the other tab
  assert.equal(run('Object.keys(loadAllStats()).length'), 0);
  playOneGame(run, 1);
  assert.equal(JSON.parse(ls.getItem('yatzy_statistics'))[run('players.player1.id')].gamesPlayed, 1);
  assert.equal(ls.getItem('yatzy_statistics_recovery'), null);
});

test('reset empties the session map', () => {
  const { run } = load({ yatzy_statistics: CORRUPT, yatzy_statistics_recovery: CORRUPT });
  playOneGame(run, 1);
  run('confirmResetStats()');
  assert.equal(run('Object.keys(loadAllStats()).length'), 0);
});
