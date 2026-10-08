// Inline onclick handlers (finding #12348). The page wires its buttons with
// onclick="name()" attributes. loadPage runs the script but never parses the
// markup, so renaming a handler (or wrapping the script) leaves the button
// dead and the suite green. This checks every onclick name is a page global,
// and that showStatsModal actually opens the modal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, stableElements } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

const yatzyHtml = readFileSync(YATZY_PATH, 'utf8');

function onclickNames(html) {
  return [...html.matchAll(/onclick="(\w+)\(/g)].map((m) => m[1]);
}

test('every yatzy onclick handler is a function in the page realm', () => {
  const names = onclickNames(yatzyHtml);
  assert.deepEqual(names, [
    'showStatsModal',
    'showPlayerNamesModal',
    'rollDice',
    'newGame',
    'applyPlayerNameEdit',
    'closeModal',
    'closeModal',
    'confirmResetStats',
    'scoreCategory',
  ]);
  const { run, loadError } = loadPage(YATZY_PATH);
  assert.equal(loadError, undefined, loadError && loadError.stack);
  for (const name of new Set(names)) {
    assert.equal(run(`typeof ${name}`), 'function', name);
  }
});

test('showStatsModal opens the stats modal and renders its content', () => {
  let elements;
  const { run, loadError } = loadPage(YATZY_PATH, {
    patch(sb) { elements = stableElements(sb, { recordClasses: true }); },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  run('showStatsModal()');
  assert.equal(elements.get('statsModal').classList.contains('show'), true);
  assert.match(
    elements.get('statsContent').innerHTML,
    /No statistics available yet/,
  );
});

test('showPlayerNamesModal opens the names modal with the current names', () => {
  let elements;
  const { run, loadError } = loadPage(YATZY_PATH, {
    patch(sb) { elements = stableElements(sb, { recordClasses: true }); },
  });
  assert.equal(loadError, undefined, loadError && loadError.stack);
  run(`players.player1.name = 'Alice'; players.player2.name = 'Bob'; showPlayerNamesModal();`);
  assert.equal(elements.get('playerNamesModal').classList.contains('show'), true);
  assert.equal(elements.get('player1Name').value, 'Alice');
  assert.equal(elements.get('player2Name').value, 'Bob');
});
