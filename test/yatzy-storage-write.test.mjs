// Refused storage writes (findings #9584, #9578): readStore already treated a
// throwing getItem as "nothing stored", but writeStore called setItem bare, so a
// blocked or full store threw out of init() before the dice were wired, and out
// of endGame() before the Play Again overlay was shown.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements, captureAlerts } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';
import { scorecardTotalling } from './yatzy-fixtures.mjs';

function refuse() {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  throw err;
}

// storage: 'refusing' (setItem/removeItem throw, getItem works), 'null'
// (Firefox with storage disabled exposes window.localStorage as null), or
// anything else for the stub's working in-memory store.
function loadWith(storage, { confirm = false } = {}) {
  let alerts;
  let elements;
  const { sandbox, run, loadError } = loadPage(YATZY_PATH, {
    patch(sb) {
      elements = stableElements(sb, { recordClasses: true });
      alerts = captureAlerts(sb);
      sb.confirm = () => confirm;
      if (storage === 'refusing') {
        sb.localStorage.setItem = refuse;
        sb.localStorage.removeItem = refuse;
      } else if (storage === 'null') {
        sb.localStorage = null;
      }
    },
  });
  return { sandbox, run, loadError, alerts, elements };
}

for (const storage of ['refusing', 'null']) {
  test(`init finishes booting when storage is ${storage}`, () => {
    const { run, loadError, alerts } = loadWith(storage);
    assert.equal(loadError, undefined, 'the page script must not throw on load');
    assert.equal(run('isRolling'), true, 'init reached its opening rollDice()');
    assert.equal(run('currentGameRolls[1]'), 1);
    assert.ok(run('players.player1.id'), 'seats exist in memory for the session');
    assert.equal(alerts.filter((a) => /refused to save/.test(a)).length, 1,
      'the player is told once, not once per write');
  });
}

test('a refused stats write still shows the game-over overlay', () => {
  const { run, elements, alerts } = loadWith('refusing');
  run(`
    player1Scores = ${JSON.stringify(scorecardTotalling(run, 0, 30))};
    player2Scores = ${JSON.stringify(scorecardTotalling(run, 0, 20))};
    endGame();
  `);
  assert.equal(elements.get('gameOver').classList.contains('show'), true,
    'Play Again lives in the overlay; it must be reachable');
  assert.match(elements.get('winnerText').innerHTML, /Player 1 Wins!/);
  assert.equal(alerts.filter((a) => /refused to save/.test(a)).length, 1,
    'still one warning for the whole session');
});

// writeStore no longer throws, so pin the ordering itself: whatever fails
// inside the stats writer, the overlay must already be up.
test('endGame shows the overlay before it records statistics', () => {
  const { sandbox, run, elements } = loadWith('working');
  sandbox.updateGameStatistics = () => { throw new Error('stats writer failed'); };
  assert.throws(() => run(`
    player1Scores = ${JSON.stringify(scorecardTotalling(run, 0, 30))};
    player2Scores = ${JSON.stringify(scorecardTotalling(run, 0, 20))};
    endGame();
  `), /stats writer failed/);
  assert.equal(elements.get('gameOver').classList.contains('show'), true);
  assert.match(elements.get('winnerText').innerHTML, /Player 1 Wins!/);
});

test('a refused reset says so instead of reporting success', () => {
  const { run, alerts } = loadWith('refusing', { confirm: true });
  run('confirmResetStats()');
  assert.match(alerts.at(-1), /could not be reset/);
  assert.equal(alerts.some((a) => /have been reset/.test(a)), false);
});
