// Render-path HTML escaping (audit #8958): yatzy.html interpolates player
// names into renderStatistics and endGame via innerHTML. escapeHtml had no
// test at all — reducing it to identity (`return String(s ?? '')`) passed
// the full suite, so a name like <img src=x onerror=…> persisted in
// localStorage would execute. stableElements keeps one element per id so
// the write is readable after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, stableElements } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';
import { scorecardTotalling } from './yatzy-fixtures.mjs';

const IMG = '<img src=x onerror=alert(1)>';
const ATTR = '" onmouseover=x';

function loadGame() {
  let elements;
  const { run } = loadPage(YATZY_PATH, {
    patch(sb) { elements = stableElements(sb); },
  });
  return { run, elements };
}

function assertEscaped(html, label) {
  assert.match(html, /&lt;img/, `${label} escapes < so the img payload cannot become a tag`);
  assert.doesNotMatch(html, /<img/, `${label} must not emit a raw <img tag`);
}

test('renderStatistics escapes the seated player name', () => {
  const game = loadGame();
  game.run(`
    players = {
      player1: { id: 'seat-xss', name: ${JSON.stringify(IMG)} },
      player2: { id: 'seat-2', name: ${JSON.stringify(ATTR)} },
    };
    saveAllStats({
      'seat-xss': {
        name: ${JSON.stringify(IMG)}, gamesPlayed: 1, wins: 1, losses: 0, draws: 0,
        totalRolls: 13, highestScore: 200, totalPoints: 200, yatzysScored: 0, bonusCount: 0,
      },
    });
    renderStatistics();
  `);
  const html = game.elements.get('statsContent').innerHTML;
  assertEscaped(html, 'renderStatistics');
});

test('endGame escapes the winner name in #winnerText', () => {
  const game = loadGame();
  game.run(`
    players = {
      player1: { id: 'seat-xss', name: ${JSON.stringify(IMG)} },
      player2: { id: 'seat-2', name: 'Bob' },
    };
    player1Scores = ${JSON.stringify(scorecardTotalling(game.run, 63, 50))};
    player2Scores = ${JSON.stringify(scorecardTotalling(game.run, 0, 0))};
    currentGameRolls = { 1: 13, 2: 13 };
    endGame();
  `);
  const html = game.elements.get('winnerText').innerHTML;
  assertEscaped(html, 'endGame');
  assert.match(html, /Wins!/, 'player 1 is the winner so the name is interpolated');
});
