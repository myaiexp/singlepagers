// A legal zero must commit through scoreCategory and stay clickable (finding
// #12570). calculateScore already returns 0 for an empty face, but the cell is
// recorded only when the score is not null, and the row is clickable only when
// potential !== null. A truthiness check at either gate would reject a scratch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements, queueTimers } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

// No ones and no pair, so both of those categories score 0. The same faces are
// a large straight (20), so the hand is not an all-zero board.
const NO_ONES = [2, 3, 4, 5, 6];

function loadGame() {
  let elements;
  let timers;
  const { sandbox, run } = loadPage(YATZY_PATH, {
    patch(sb) {
      elements = stableElements(sb);
      ({ timers } = queueTimers(sb));
    },
  });
  // init() has an opening roll in flight. Drop it and pin a settled hand.
  timers.length = 0;
  run(`
    currentSeatNo = 1;
    isRolling = false;
    hasRolled = true;
    rollsRemaining = 2;
    diceValues = ${JSON.stringify(NO_ONES)};
    freshScorecards();
  `);
  return { sandbox, run, elements };
}

function categoryRow(html, id) {
  const match = html.match(new RegExp(
    `<div class="([^"]*)"[\\s\\S]*?data-cat-id="${id}"([\\s\\S]*?)>` +
      `[\\s\\S]*?<div class="score-value">([^<]*)</div>`,
  ));
  assert.ok(match, `score row for ${id} was not rendered`);
  return { className: match[1], attrs: match[2], value: match[3] };
}

test('a zero ones score is clickable and shows (0)', () => {
  const { run, elements } = loadGame();
  run('renderScorecard(1, true);');
  const ones = categoryRow(elements.get('scorecardBody1').innerHTML, 'ones');
  assert.match(ones.className, /\bclickable\b/);
  assert.match(ones.attrs, /onclick="scoreCategory\('ones'\)"/);
  assert.equal(ones.value, '(0)');
});

test('scoreCategory commits 0 for ones and advances the turn', () => {
  const { sandbox, run, elements } = loadGame();
  assert.equal(run(`calculateScore('ones')`), 0);

  sandbox.scoreCategory('ones');

  assert.equal(
    run(`player1Scores.upper.find(c => c.id === 'ones').value`),
    0,
    'a zero must be stored; null is the only empty score',
  );
  assert.equal(run('currentSeatNo'), 2, 'scoring a zero must end the turn');
  const filled = categoryRow(elements.get('scorecardBody1').innerHTML, 'ones');
  assert.equal(filled.value, '0', 'a stored zero must render as 0, not a blank');
  assert.doesNotMatch(filled.className, /\bclickable\b/);
});
