// Smoke test (audit #1372): loading yatzy.html must NOT wipe persisted
// player names / statistics. The original bug ran two unconditional
// localStorage.removeItem() calls at the top of the page script, erasing both
// keys on every page load and making the Statistics modal effectively useless.

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

// Run the page's real <script> against the no-deps DOM stub, then return the
// resulting localStorage. Any late DOM-stub miss is tolerated: the bug under test
// executes at the very top of the script, before anything that could throw, so the
// localStorage outcome is already fixed by the time control returns here.
function simulateLoad(seed) {
  const code = extractScript(readFileSync(yatzyPath, 'utf8'));
  const sandbox = createSandbox(seed);
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { filename: 'yatzy.html#script' });
  } catch (err) {
    console.warn(`[smoke] script threw during simulated load (tolerated): ${err.message}`);
  }
  return sandbox.localStorage;
}

const NAMES = JSON.stringify({ player1: 'Alice', player2: 'Bob' });
const STATS = JSON.stringify({ Alice: { gamesPlayed: 3, wins: 2, totalScore: 540 } });

test('player names survive a page load', () => {
  const ls = simulateLoad({ yatzy_playerNames: NAMES, yatzy_statistics: STATS });
  assert.equal(ls.getItem('yatzy_playerNames'), NAMES, 'yatzy_playerNames was wiped on load');
});

test('statistics survive a page load', () => {
  const ls = simulateLoad({ yatzy_playerNames: NAMES, yatzy_statistics: STATS });
  assert.equal(ls.getItem('yatzy_statistics'), STATS, 'yatzy_statistics was wiped on load');
});
