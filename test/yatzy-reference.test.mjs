// Reference-panel tiles (finding #12353). The DOM stub returns no
// `.reference-item` nodes — a generic list makes syncReferencePanel read
// catScores[NaN] during init — so the per-tile loop never runs. Parse the
// markup and drive the real function with those tiles.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from './dom-stub.mjs';
import { YATZY_PATH } from './pages.mjs';

const yatzyHtml = readFileSync(YATZY_PATH, 'utf8');

function attribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? match[1] : null;
}

// Opening tags only. A reference-item with neither data attribute (the bonus
// target) is not in the page's `.reference-item[data-section]` selector, so
// it is skipped. A tag with only one of the two attributes is kept and fails
// the alignment test instead of disappearing.
function referenceItems(html) {
  const tags = [...html.matchAll(/<div class="reference-item"[^>]*>/g)].map((m) => m[0]);
  const tiles = [];
  for (const tag of tags) {
    const section = attribute(tag, 'data-section');
    const indexRaw = attribute(tag, 'data-category-index');
    if (section === null && indexRaw === null) continue;
    tiles.push({ section, indexRaw });
  }
  return tiles;
}

function tileElements(tiles) {
  return tiles.map((tile) => ({
    dataset: { section: tile.section, categoryIndex: tile.indexRaw },
    style: {},
  }));
}

// The page calls this exact selector. Anything else keeps the stub's list,
// so dice and confetti lookups are unchanged.
const REFERENCE_SELECTOR = '.reference-item[data-section]';

function showReferenceTiles(sandbox, elements) {
  const querySelectorAll = sandbox.document.querySelectorAll.bind(sandbox.document);
  sandbox.document.querySelectorAll = (selector) => {
    if (selector === REFERENCE_SELECTOR) return elements;
    return querySelectorAll(selector);
  };
}

function loadWithTiles() {
  const tiles = referenceItems(yatzyHtml);
  const elements = tileElements(tiles);
  const loaded = loadPage(YATZY_PATH, {
    patch(sandbox) { showReferenceTiles(sandbox, elements); },
  });
  return { elements, ...loaded };
}

function tileAt(elements, section, index) {
  const found = elements.filter((el) =>
    el.dataset.section === section && Number(el.dataset.categoryIndex) === index);
  assert.equal(found.length, 1, `${section}[${index}]`);
  return found[0];
}

function assertShown(elements, hidden) {
  const hiddenSet = new Set(hidden);
  for (const el of elements) {
    const label = `${el.dataset.section}[${el.dataset.categoryIndex}]`;
    assert.equal(el.style.display, hiddenSet.has(el) ? 'none' : 'block', label);
  }
}

test('each reference tile addresses exactly one scoreCategories row', () => {
  const tiles = referenceItems(yatzyHtml);
  const { run, loadError } = loadPage(YATZY_PATH);
  assert.equal(loadError, undefined, loadError && loadError.stack);
  const categories = JSON.parse(run('JSON.stringify(scoreCategories)'));
  const covered = new Set();

  for (const tile of tiles) {
    assert.match(String(tile.indexRaw), /^\d+$/, `${tile.section} index ${tile.indexRaw}`);
    const index = Number(tile.indexRaw);
    const rows = categories[tile.section];
    assert.ok(Array.isArray(rows), `no scoreCategories.${tile.section}`);
    assert.ok(rows[index], `${tile.section}[${index}] is not a category`);
    const key = `${tile.section}:${index}`;
    assert.equal(covered.has(key), false, `two tiles for ${key} (${rows[index].id})`);
    covered.add(key);
  }

  for (const section of Object.keys(categories)) {
    categories[section].forEach((row, index) => {
      assert.ok(covered.has(`${section}:${index}`), `${section}.${row.id} has no tile`);
    });
  }
});

test("syncReferencePanel hides only the active player's filled tile", () => {
  const { elements, run, loadError } = loadWithTiles();
  assert.equal(loadError, undefined, loadError && loadError.stack);
  const categories = JSON.parse(run('JSON.stringify(scoreCategories)'));
  const onesIndex = categories.upper.findIndex((row) => row.id === 'ones');
  assert.ok(onesIndex >= 0, 'scoreCategories.upper has no ones row');
  const ones = tileAt(elements, 'upper', onesIndex);

  // The panel reads the active seat's .value. The other seat's card must not
  // hide a tile, and a stored 0 is filled — null is the only empty score.
  // Setting the value skips scoreCategory, which would end the turn and sync
  // again for the other seat.
  run(`
    currentSeatNo = 1;
    freshScorecards();
    player2Scores.upper[${onesIndex}].value = 4;
  `);
  run('syncReferencePanel()');
  assertShown(elements, []);

  run(`player1Scores.upper[${onesIndex}].value = 0;`);
  run('syncReferencePanel()');
  assertShown(elements, [ones]);

  run(`
    currentSeatNo = 2;
    player1Scores.upper[${onesIndex}].value = null;
  `);
  run('syncReferencePanel()');
  assertShown(elements, [ones]);

  run(`player2Scores.upper[${onesIndex}].value = null;`);
  run('syncReferencePanel()');
  assertShown(elements, []);
});
