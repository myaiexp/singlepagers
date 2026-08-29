// Turn/roll state machine (audit #8235, #8233): overlapping rollDice calls
// must consume one roll, not two, and scoreCategory during the 500ms settle
// must not run nextTurn. The render-once harness fires setTimeout inline, which
// cannot observe overlap — this file queues timers and flushes them on demand.

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

function loadGame() {
  const timers = [];
  let nextId = 1;
  const sandbox = createSandbox({});
  const byId = new Map();
  const origGet = sandbox.document.getElementById.bind(sandbox.document);
  sandbox.document.getElementById = (id) => {
    if (!byId.has(id)) byId.set(id, origGet(id));
    return byId.get(id);
  };
  // Empty NodeList: the default stub yields 5 fake nodes, and
  // syncReferencePanel then reads catScores[NaN].value and throws
  // before scoreCategory can reach nextTurn.
  sandbox.document.querySelectorAll = () => [];
  sandbox.setTimeout = (fn) => {
    const id = nextId++;
    timers.push({ id, fn });
    return id;
  };
  sandbox.clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i !== -1) timers.splice(i, 1);
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(extractScript(readFileSync(yatzyPath, 'utf8')), sandbox, {
      filename: 'yatzy.html#script',
    });
  } catch (err) {
    console.warn(`[turn] init threw during simulated load (tolerated): ${err.message}`);
  }
  // Drop init's opening roll if it queued one, and pin a known pre-roll state.
  timers.length = 0;
  vm.runInContext(
    `
    currentPlayer = 1;
    rollsRemaining = 3;
    hasRolled = false;
    currentGameRolls = 0;
    keptDice = [false, false, false, false, false];
    diceValues = [1, 2, 3, 4, 5];
    player1Scores = JSON.parse(JSON.stringify(scoreCategories));
    player2Scores = JSON.parse(JSON.stringify(scoreCategories));
    isRolling = false;
    `,
    sandbox,
  );
  const flush = () => {
    const batch = timers.splice(0);
    for (const t of batch) {
      if (typeof t.fn === 'function') t.fn();
    }
  };
  const read = (expr) => vm.runInContext(expr, sandbox);
  const rollBtn = () => sandbox.document.getElementById('rollBtn');
  return { sandbox, flush, timers, read, rollBtn };
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
  assert.equal(read('currentGameRolls'), 1, 'second click must not count as a second roll');
  assert.equal(rollBtn().disabled, true, 'Roll button stays disabled while dice are settling');

  flush();

  assert.equal(read('rollsRemaining'), 2, `expected one roll consumed, got remaining=${read('rollsRemaining')}`);
  assert.equal(read('currentGameRolls'), 1);
  assert.equal(rollBtn().disabled, false, 'Roll button re-enables when rolls remain');
});

test('scoreCategory during a pending roll does not run nextTurn until dice settle', () => {
  const { sandbox, flush, read } = loadGame();

  let nextTurnCalls = 0;
  const originalNextTurn = sandbox.nextTurn;
  sandbox.nextTurn = (...args) => {
    nextTurnCalls++;
    return originalNextTurn(...args);
  };

  sandbox.rollDice();
  sandbox.scoreCategory('ones');

  assert.equal(nextTurnCalls, 0, 'nextTurn must not run while a roll is in flight');
  assert.equal(read('currentPlayer'), 1, 'player must not switch during the settle window');
  assert.equal(onesValue(read), null, 'category must not fill against unsettled dice');
  assert.equal(read('rollsRemaining'), 3);

  flush();

  assert.equal(nextTurnCalls, 0, 'settling the roll must not itself score or change turns');
  assert.equal(read('currentPlayer'), 1);
  assert.equal(read('rollsRemaining'), 2);
  assert.equal(onesValue(read), null);

  sandbox.scoreCategory('ones');
  assert.equal(nextTurnCalls, 1, 'scoring after settle must end the turn');
  assert.notEqual(onesValue(read), null, 'ones should fill after a settled roll');
  assert.equal(read('currentPlayer'), 2);
});

test('rollDice then scoreCategory then nextTurn runs as one turn sequence', () => {
  const { sandbox, flush, read } = loadGame();

  sandbox.rollDice();
  flush();
  assert.equal(read('rollsRemaining'), 2);
  assert.equal(read('hasRolled'), true);
  assert.equal(read('currentPlayer'), 1);

  const settledSum = read('diceValues.reduce((a, b) => a + b, 0)');
  sandbox.scoreCategory('chance');
  assert.equal(read('currentPlayer'), 2, 'scoring must hand the turn to player 2');
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
  assert.equal(read('currentPlayer'), 2);
});

test('newGame during a pending roll cancels the in-flight settle', () => {
  const { sandbox, flush, read } = loadGame();

  sandbox.rollDice();
  assert.equal(read('currentGameRolls'), 1);
  sandbox.newGame();
  flush();

  assert.equal(read('currentPlayer'), 1);
  assert.equal(read('rollsRemaining'), 2, 'only the new-game opening roll should settle');
  assert.equal(read('currentGameRolls'), 1, 'newGame resets the counter then auto-rolls once');
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
  assert.equal(read('currentGameRolls'), 3);
  assert.equal(rollBtn().disabled, true, 'Roll button disables when no rolls remain');

  sandbox.rollDice();
  flush();
  assert.equal(read('rollsRemaining'), 0, 'a fourth roll must be a no-op');
  assert.equal(read('currentGameRolls'), 3);
});
