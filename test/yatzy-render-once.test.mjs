// Regression test (audit #1378): each roll must re-render the active scorecard
// exactly once. The original rollDice() called renderScorecard(currentPlayer) and
// then enableScoring() — which itself calls renderScorecard(currentPlayer, true) —
// so every roll rendered the scorecard twice, doing redundant DOM work. enableScoring
// runs after every roll (rollsRemaining is always < 3 post-decrement), so the prior
// standalone render was pure waste. This pins the flow to a single render per roll.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

// Load the page script with a synchronous setTimeout so rollDice()'s deferred callback
// (where the dice settle and the scorecard renders) runs inline — the dom-stub's default
// setTimeout is a no-op that would skip the roll body. init()'s opening roll therefore
// also settles, so the test spies renderScorecard after that first roll has already run.
function loadGame() {
  const { sandbox } = loadPage(yatzyPath, {
    patch(s) {
      s.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
    },
  });
  return sandbox;
}

test('a roll re-renders the active scorecard exactly once', () => {
  const sandbox = loadGame();

  assert.equal(typeof sandbox.renderScorecard, 'function', 'page defined renderScorecard');
  assert.equal(typeof sandbox.rollDice, 'function', 'page defined rollDice');

  // Spy on renderScorecard. It's a function declaration (a context global), so
  // enableScoring()'s internal call resolves through the global to this spy.
  const original = sandbox.renderScorecard;
  let renders = 0;
  sandbox.renderScorecard = (...args) => { renders++; return original(...args); };

  // One roll: rollsRemaining goes 3 -> 2, so enableScoring() fires and renders the
  // active scorecard. The old code also rendered it once beforehand (two renders);
  // the fix collapses that to the single enableScoring() render.
  sandbox.rollDice();

  assert.equal(renders, 1, `expected a single scorecard render per roll, got ${renders}`);
});
