// Refused storage writes (findings #9584, #9578): readStore already treated a
// throwing getItem as "nothing stored", but writeStore called setItem bare, so a
// blocked or full store threw out of init() before the dice were wired, and out
// of endGame() before the Play Again overlay was shown.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage, createDocument, recordingClassList } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

function refuse() {
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  throw err;
}

// storage: 'refusing' (setItem/removeItem throw, getItem works), 'null'
// (Firefox with storage disabled exposes window.localStorage as null), or
// anything else for the stub's working in-memory store.
function loadWith(storage, { confirm = false } = {}) {
  const alerts = [];
  const elements = new Map();
  const { sandbox, run, loadError } = loadPage(yatzyPath, {
    patch(sb) {
      const doc = createDocument();
      sb.document = {
        ...doc,
        getElementById(id) {
          if (!elements.has(id)) {
            const el = doc.getElementById(id);
            el.classList = recordingClassList();
            elements.set(id, el);
          }
          return elements.get(id);
        },
      };
      sb.alert = (msg) => alerts.push(String(msg));
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

function scorecardTotalling(lower) {
  const row = (id, value) => ({ id, name: id, value });
  return {
    upper: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].map((id) => row(id, 0)),
    lower: [row('chance', lower), row('yatzy', 0)],
  };
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
    player1Scores = ${JSON.stringify(scorecardTotalling(30))};
    player2Scores = ${JSON.stringify(scorecardTotalling(20))};
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
    player1Scores = ${JSON.stringify(scorecardTotalling(30))};
    player2Scores = ${JSON.stringify(scorecardTotalling(20))};
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
