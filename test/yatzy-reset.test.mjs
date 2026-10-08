// Shared turn/game reset (finding #11976). nextTurn and newGame used to each
// assign the dice fields by hand. A new per-turn field added in only one of
// them drifts, and the turn harness had to copy the list. These tests call
// the page's own helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements, queueTimers, spyOn } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

function loadGame() {
  let timers;
  const { sandbox, run } = loadPage(YATZY_PATH, {
    patch(sb) {
      stableElements(sb, { recordClasses: true });
      stableElements(sb, { method: 'querySelector', recordClasses: true });
      ({ timers } = queueTimers(sb));
    },
  });
  timers.length = 0;
  run('isRolling = false;');
  return { sandbox, run };
}

function arr(run, expr) {
  return JSON.parse(run(`JSON.stringify(${expr})`));
}

test('resetTurnState restores the pre-roll dice without touching the cards', () => {
  const { sandbox, run } = loadGame();
  run(`
    keptDice = [true, true, false, false, true];
    diceValues = [6, 6, 6, 6, 6];
    rollsRemaining = 0;
    hasRolled = true;
    player1Scores.upper[0].value = 4;
    currentGameRolls = { 1: 4, 2: 5 };
  `);
  sandbox.resetTurnState();
  assert.deepEqual(arr(run, 'keptDice'), [false, false, false, false, false]);
  assert.deepEqual(arr(run, 'diceValues'), [1, 2, 3, 4, 5]);
  assert.equal(run('rollsRemaining'), 3);
  assert.equal(run('hasRolled'), false);
  assert.equal(run('player1Scores.upper[0].value'), 4);
  assert.equal(run('currentGameRolls[1]'), 4);
});

test('nextTurn resets the turn only; newGame also deals fresh cards', () => {
  const { sandbox, run } = loadGame();
  run(`
    keptDice = [true, false, true, false, true];
    diceValues = [6, 5, 4, 3, 2];
    rollsRemaining = 0;
    hasRolled = true;
    player1Scores.upper[0].value = 4;
    currentGameRolls = { 1: 4, 2: 5 };
    currentSeatNo = 1;
  `);
  const resets = spyOn(sandbox, 'resetTurnState');
  const fresh = spyOn(sandbox, 'freshScorecards');
  const paints = spyOn(sandbox, 'renderScorecards');

  sandbox.nextTurn();

  assert.equal(resets.count, 1);
  assert.equal(fresh.count, 0, 'a turn change must not redeal the cards');
  assert.equal(paints.count, 1);
  assert.deepEqual(arr(run, 'keptDice'), [false, false, false, false, false]);
  assert.deepEqual(arr(run, 'diceValues'), [1, 2, 3, 4, 5]);
  assert.equal(run('rollsRemaining'), 3);
  assert.equal(run('currentSeatNo'), 2);
  assert.equal(run('player1Scores.upper[0].value'), 4);
  assert.equal(run('currentGameRolls[1]'), 4, 'seat 1\'s roll count survives the turn');
  assert.equal(run('currentGameRolls[2]'), 6, 'the auto-roll is seat 2\'s');

  sandbox.newGame();

  assert.equal(resets.count, 2);
  assert.equal(fresh.count, 1);
  assert.equal(paints.count, 2);
  assert.equal(run('player1Scores.upper[0].value'), null);
  assert.equal(run('currentSeatNo'), 1);
  assert.equal(run('currentGameRolls[1]'), 1, 'newGame zeroes counts, then the opening roll adds one');
  assert.equal(run('currentGameRolls[2]'), 0);
  assert.equal(run('rollsRemaining'), 3);
});
