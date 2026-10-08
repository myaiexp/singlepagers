// Turn/roll state machine (audit #8235, #8233): overlapping rollDice calls
// must consume one roll, not two, and scoreCategory during the 500ms settle
// must not run nextTurn. The render-once harness fires setTimeout inline, which
// cannot observe overlap — this file queues timers and flushes them on demand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements, queueTimers, spyOn } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

// `read(expr)` evaluates an expression in the page realm and returns its value;
// `exec(src)` runs statements there to set up a precondition. Both are the
// loadPage runner — the split only tells the reader which one a line is doing.
function loadGame() {
  let timers;
  let flush;
  const { sandbox, run } = loadPage(YATZY_PATH, {
    patch(s) {
      // Stable lookups with a recording classList, so #gameOver's `show` and
      // the score-flash row's `just-scored` can be read back.
      stableElements(s, { recordClasses: true });
      stableElements(s, { method: 'querySelector', recordClasses: true });
      ({ timers, flush } = queueTimers(s));
    },
  });
  // Drop init's opening roll if it queued one, and pin a known pre-roll state.
  timers.length = 0;
  run(`
    currentSeatNo = 1;
    currentGameRolls = { 1: 0, 2: 0 };
    resetTurnState();
    freshScorecards();
    isRolling = false;
  `);
  const rollBtn = () => sandbox.document.getElementById('rollBtn');
  return { sandbox, flush, timers, read: run, exec: run, rollBtn };
}

function onesValue(read) {
  return read(`player1Scores.upper.find(c => c.id === 'ones').value`);
}

test('double-invoking rollDice during the settle window consumes one roll, not two', () => {
  const { sandbox, flush, read, rollBtn } = loadGame();

  assert.equal(read('rollsRemaining'), 3);
  sandbox.rollDice();
  sandbox.rollDice();

  assert.equal(read('rollsRemaining'), 3, 'rollsRemaining must not drop until the settle callback');
  assert.equal(read('currentGameRolls[1]'), 1, 'second click must not count as a second roll');
  assert.equal(rollBtn().disabled, true, 'Roll button stays disabled while dice are settling');

  flush();

  assert.equal(read('rollsRemaining'), 2, `expected one roll consumed, got remaining=${read('rollsRemaining')}`);
  assert.equal(read('currentGameRolls[1]'), 1);
  assert.equal(rollBtn().disabled, false, 'Roll button re-enables when rolls remain');
});

test('scoreCategory during a pending roll does not run nextTurn until dice settle', () => {
  const { sandbox, flush, read } = loadGame();
  const nextTurn = spyOn(sandbox, 'nextTurn');

  sandbox.rollDice();
  sandbox.scoreCategory('ones');

  assert.equal(nextTurn.count, 0, 'nextTurn must not run while a roll is in flight');
  assert.equal(read('currentSeatNo'), 1, 'player must not switch during the settle window');
  assert.equal(onesValue(read), null, 'category must not fill against unsettled dice');
  assert.equal(read('rollsRemaining'), 3);

  flush();

  assert.equal(nextTurn.count, 0, 'settling the roll must not itself score or change turns');
  assert.equal(read('currentSeatNo'), 1);
  assert.equal(read('rollsRemaining'), 2);
  assert.equal(onesValue(read), null);

  sandbox.scoreCategory('ones');
  assert.equal(nextTurn.count, 1, 'scoring after settle must end the turn');
  assert.notEqual(onesValue(read), null, 'ones should fill after a settled roll');
  assert.equal(read('currentSeatNo'), 2);
});

test('rollDice then scoreCategory then nextTurn runs as one turn sequence', () => {
  const { sandbox, flush, read } = loadGame();

  sandbox.rollDice();
  flush();
  assert.equal(read('rollsRemaining'), 2);
  assert.equal(read('hasRolled'), true);
  assert.equal(read('currentSeatNo'), 1);

  const settledSum = read('diceValues.reduce((a, b) => a + b, 0)');
  sandbox.scoreCategory('chance');
  assert.equal(read('currentSeatNo'), 2, 'scoring must hand the turn to player 2');
  assert.equal(
    read(`player1Scores.lower.find(c => c.id === 'chance').value`),
    settledSum,
    'chance must record the settled dice, not the next turn\'s reset faces',
  );
  // nextTurn auto-rolls for the next player; that roll is still in flight.
  assert.equal(read('rollsRemaining'), 3, 'next player starts with 3 rolls, decrement pending');
  assert.equal(read('hasRolled'), true, 'auto-roll has started');

  flush();
  assert.equal(read('rollsRemaining'), 2, 'next player auto-roll consumes one roll');
  assert.equal(read('currentSeatNo'), 2);
  // finding #9577: the auto-roll is player 2's, not added to player 1's count.
  assert.equal(read('currentGameRolls[1]'), 1);
  assert.equal(read('currentGameRolls[2]'), 1);
});

test('newGame during a pending roll cancels the in-flight settle', () => {
  const { sandbox, flush, read } = loadGame();

  sandbox.rollDice();
  assert.equal(read('currentGameRolls[1]'), 1);
  sandbox.newGame();
  flush();

  assert.equal(read('currentSeatNo'), 1);
  assert.equal(read('rollsRemaining'), 2, 'only the new-game opening roll should settle');
  assert.equal(read('currentGameRolls[1]'), 1, 'newGame resets the counter then auto-rolls once');
});

test('sequential rolls after each settle still consume one roll each', () => {
  const { sandbox, flush, read, rollBtn } = loadGame();

  sandbox.rollDice();
  flush();
  sandbox.rollDice();
  flush();
  sandbox.rollDice();
  flush();

  assert.equal(read('rollsRemaining'), 0);
  assert.equal(read('currentGameRolls[1]'), 3);
  assert.equal(rollBtn().disabled, true, 'Roll button disables when no rolls remain');

  sandbox.rollDice();
  flush();
  assert.equal(read('rollsRemaining'), 0, 'a fourth roll must be a no-op');
  assert.equal(read('currentGameRolls[1]'), 3);
});

// --- player 2 and the end of the game (finding #10355, #9576) ---------------
// Every other turn test scores as player 1 on an empty card, so scoreCategory's
// player2Scores branch and its isGameOver → endGame path were never entered.

// Fill every category on one card with 0, leaving `except` open.
function fillCard(exec, card, except = null) {
  exec(`[...${card}.upper, ...${card}.lower].forEach(c => {
    if (c.id !== ${JSON.stringify(except)}) c.value = 0;
  })`);
}

test('scoring as player 2 fills player2Scores, not player 1\'s card', () => {
  const { sandbox, flush, read, exec } = loadGame();
  exec('currentSeatNo = 2');
  sandbox.rollDice();
  flush();

  const settledSum = read('diceValues.reduce((a, b) => a + b, 0)');
  sandbox.scoreCategory('chance');

  assert.equal(read(`player2Scores.lower.find(c => c.id === 'chance').value`), settledSum);
  assert.equal(read(`player1Scores.lower.find(c => c.id === 'chance').value`), null,
    'seat 1\'s card must be untouched');
  assert.equal(read('currentSeatNo'), 1, 'the turn passes back to player 1');
  assert.equal(read('currentGameRolls[2]'), 1);
});

test('scoring the last open cell ends the game instead of passing the turn', () => {
  const { sandbox, flush, read, exec } = loadGame();
  fillCard(exec, 'player1Scores');
  fillCard(exec, 'player2Scores', 'chance');
  exec('currentSeatNo = 2');
  const nextTurn = spyOn(sandbox, 'nextTurn');
  const endGame = spyOn(sandbox, 'endGame');

  sandbox.rollDice();
  flush();
  sandbox.scoreCategory('chance');

  assert.equal(endGame.count, 1, 'the final cell must end the game');
  assert.equal(nextTurn.count, 0, 'a finished game must not start another turn');
  assert.equal(read('currentSeatNo'), 2);
  assert.equal(sandbox.document.getElementById('gameOver').classList.contains('show'), true,
    'the game-over overlay is shown');
  assert.match(sandbox.document.getElementById('winnerText').innerHTML, /Player 2 Wins!/,
    'player 1 scored 0 everywhere, so the settled chance roll wins it for player 2');

  const p1 = read('getPlayerStats(players.player1.id)');
  const p2 = read('getPlayerStats(players.player2.id)');
  assert.deepEqual([p1.gamesPlayed, p1.losses, p1.totalRolls], [1, 1, 0]);
  assert.deepEqual([p2.gamesPlayed, p2.wins, p2.totalRolls], [1, 1, 1]);
});

test('a complete card does not end the game while the other still has an open cell', () => {
  const { sandbox, flush, read, exec } = loadGame();
  fillCard(exec, 'player1Scores', 'chance');
  fillCard(exec, 'player2Scores', 'chance');
  exec('currentSeatNo = 2');
  const nextTurn = spyOn(sandbox, 'nextTurn');
  const endGame = spyOn(sandbox, 'endGame');

  sandbox.rollDice();
  flush();
  sandbox.scoreCategory('chance');

  assert.equal(endGame.count, 0, 'player 1 still has chance open');
  assert.equal(nextTurn.count, 1);
  assert.equal(read('currentSeatNo'), 1);
});

test('the score flash lands on the scoring player\'s row, not the next player\'s', () => {
  const { sandbox, flush, read } = loadGame();
  sandbox.rollDice();
  flush();
  sandbox.scoreCategory('chance');
  assert.equal(read('currentSeatNo'), 2, 'the turn has passed before the flash timer fires');

  flush(); // the 100ms flash timer (plus player 2's settle)

  const row = (player) =>
    sandbox.document.querySelector(`#scorecardBody${player} [data-cat-id="chance"]`);
  assert.equal(row(1).classList.contains('just-scored'), true, 'player 1 scored chance');
  assert.equal(row(2).classList.contains('just-scored'), false,
    'player 2\'s unfilled chance row must not flash');
});

// --- kept dice / toggleKeepDie / getDieFace (finding #8960) -----------------
// rollDice's `if (!keptDice[i])` branch and toggleKeepDie's three guards were
// never entered: every harness resets keptDice to all-false and never clicks a
// die. These tests drive the real functions against flushable timers.

function forceRandom(sandbox, value) {
  const fake = Object.create(sandbox.Math);
  fake.random = () => value;
  sandbox.Math = fake;
}

// Arrays born in the vm realm fail assert.deepEqual against host literals
// (different Array constructor). Round-trip through JSON for a host copy.
function arr(read, expr) {
  return JSON.parse(read(`JSON.stringify(${expr})`));
}

test('held dice keep their face across a subsequent roll', () => {
  const { sandbox, flush, read, exec } = loadGame();

  sandbox.rollDice();
  flush();
  sandbox.toggleKeepDie(0);
  sandbox.toggleKeepDie(1);
  assert.deepEqual(arr(read, 'keptDice'), [true, true, false, false, false]);

  exec('diceValues = [1, 2, 3, 4, 5]');
  forceRandom(sandbox, 0.99); // Math.floor(0.99 * 6) + 1 === 6

  sandbox.rollDice();
  flush();

  assert.deepEqual(arr(read, 'diceValues'), [1, 2, 6, 6, 6],
    'indices 0-1 are held so they must stay 1,2; unheld faces re-roll to 6');
});

test('toggleKeepDie is a no-op before the first roll', () => {
  const { sandbox, read } = loadGame();
  assert.equal(read('hasRolled'), false);
  assert.equal(read('rollsRemaining'), 3);
  sandbox.toggleKeepDie(0);
  assert.deepEqual(arr(read, 'keptDice'), [false, false, false, false, false]);
});

test('toggleKeepDie is a no-op while dice are settling', () => {
  const { sandbox, flush, read } = loadGame();
  sandbox.rollDice();
  assert.equal(read('isRolling'), true);
  sandbox.toggleKeepDie(0);
  assert.deepEqual(arr(read, 'keptDice'), [false, false, false, false, false],
    'must not lock a face against dice that have not settled');
  flush();
});

test('toggleKeepDie is a no-op at rollsRemaining === 3 even if hasRolled is true', () => {
  const { sandbox, read, exec } = loadGame();
  exec('hasRolled = true; rollsRemaining = 3; isRolling = false;');
  sandbox.toggleKeepDie(2);
  assert.deepEqual(arr(read, 'keptDice'), [false, false, false, false, false]);
});

test('toggleKeepDie flips a die after a settled roll and flips it back', () => {
  const { sandbox, flush, read } = loadGame();
  sandbox.rollDice();
  flush();
  sandbox.toggleKeepDie(4);
  assert.deepEqual(arr(read, 'keptDice'), [false, false, false, false, true]);
  sandbox.toggleKeepDie(4);
  assert.deepEqual(arr(read, 'keptDice'), [false, false, false, false, false]);
});

test('getDieFace maps 1..6 onto the six pip glyphs', () => {
  const { read } = loadGame();
  const faces = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' };
  for (const [value, glyph] of Object.entries(faces)) {
    assert.equal(read(`getDieFace(${value})`), glyph, `face ${value}`);
  }
});
