// Regression test (audit #1378): each roll must re-render the active scorecard
// exactly once. The original rollDice() called renderScorecard(currentPlayer) and
// then enableScoring() — which itself calls renderScorecard(currentPlayer, true) —
// so every roll rendered the scorecard twice, doing redundant DOM work. enableScoring
// runs after every roll (rollsRemaining is always < 3 post-decrement), so the prior
// standalone render was pure waste. This pins the flow to a single render per roll.

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

// Load the page script with a synchronous setTimeout so rollDice()'s deferred callback
// (where the dice settle and the scorecard renders) runs inline — the dom-stub's default
// setTimeout is a no-op that would skip the roll body. init() also touches reference-panel
// DOM the no-deps stub doesn't fully model and throws partway; that's tolerated like the
// load-persistence smoke test. All page functions are hoisted function declarations, so
// rollDice/renderScorecard/enableScoring are defined regardless, and rollsRemaining keeps
// its initial value of 3 (init's own first roll never ran).
function loadGame() {
  const code = extractScript(readFileSync(yatzyPath, 'utf8'));
  const sandbox = createSandbox({});
  sandbox.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; };
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: 'yatzy.html#script' });
  } catch (err) {
    console.warn(`[render-once] init threw during simulated load (tolerated): ${err.message}`);
  }
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
