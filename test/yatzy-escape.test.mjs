// Render-path HTML escaping (audit #8958): yatzy.html interpolates player
// names into renderStatistics and endGame via innerHTML. escapeHtml had no
// test at all — reducing it to identity (`return String(s ?? '')`) passed
// the full suite, so a name like <img src=x onerror=…> persisted in
// localStorage would execute. Identity-preserving getElementById is the
// same trick as test/yatzy-bonus.test.mjs so the write is readable after.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage, createDocument } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const yatzyPath = join(here, '..', 'yatzy.html');

const IMG = '<img src=x onerror=alert(1)>';
const ATTR = '" onmouseover=x';

function loadGame() {
  const elements = new Map();
  const { run } = loadPage(yatzyPath, {
    patch(sb) {
      const doc = createDocument();
      sb.document = {
        ...doc,
        getElementById(id) {
          if (!elements.has(id)) elements.set(id, doc.getElementById(id));
          return elements.get(id);
        },
      };
    },
  });
  return { run, elements };
}

function scorecardTotalling(upper, lower) {
  const row = (id, value) => ({ id, name: id, value });
  return {
    upper: [row('ones', upper), row('twos', 0), row('threes', 0),
      row('fours', 0), row('fives', 0), row('sixes', 0)],
    lower: [row('threeOfAKind', lower), row('fourOfAKind', 0), row('fullHouse', 0),
      row('smallStraight', 0), row('largeStraight', 0), row('yatzy', 0), row('chance', 0)],
  };
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
    syncPlayerNamesView();
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
    syncPlayerNamesView();
    player1Scores = ${JSON.stringify(scorecardTotalling(63, 50))};
    player2Scores = ${JSON.stringify(scorecardTotalling(0, 0))};
    currentGameRolls = 13;
    endGame();
  `);
  const html = game.elements.get('winnerText').innerHTML;
  assertEscaped(html, 'endGame');
  assert.match(html, /Wins!/, 'player 1 is the winner so the name is interpolated');
});
