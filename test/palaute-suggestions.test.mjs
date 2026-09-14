// Suggestion-engine tests (idea #1603): palaute.html's free-text autocomplete —
// distinctAnswers (dedup + frequency) and suggestionsFor (substring boost, fuzzy
// ranking, cap) — plus the two pure helpers the entry/review views depend on,
// cloneForm and escapeHtml. Audit #1513 covered only the Yatzy scoring engine and
// #1517 only dice(); this is the layer above them.
//
// These are characterization tests over shipped behavior, so they pass on their
// first run by construction — they pin the documented contract (the comments
// above each function) so a later change to the ranking cannot drift silently.
//
// Same no-deps approach as palaute-cursor.test.mjs: loadPage runs the page's real
// <script> under node:vm against the stub DOM, with ZERO changes to palaute.html.
// `forms` is a top-level `let`, so tests seed it and call the real functions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const { run } = loadPage(PALAUTE_PATH);

// The page's own free-text keys, read from FREETEXT so fixtures seed fields the
// form really has: KEY is the first question (`best`, "Mikä oli päivien parasta
// antia?"), OTHER_KEY the second (`improve`).
const [KEY, OTHER_KEY] = JSON.parse(run('JSON.stringify(FREETEXT.map(ft => ft.key))'));

// Seed `forms` with one entry per answer to free-text question `key`.
// Only .free matters to the suggestion engine, so the rest of the shape is
// irrelevant here — but blankForm() supplies it so the fixtures stay realistic.
function seedAnswers(key, answers) {
  run(`forms = ${JSON.stringify(answers)}.map(t => {
         const f = blankForm();
         f.free[${JSON.stringify(key)}] = t;
         return f;
       });`);
}

const distinct = (key) => run(`JSON.stringify(distinctAnswers(${JSON.stringify(key)}));`);
const suggest = (key, input) =>
  JSON.parse(run(`JSON.stringify(suggestionsFor(${JSON.stringify(key)}, ${JSON.stringify(input)}));`));

const texts = (rows) => rows.map(r => r.text);

// --- distinctAnswers: dedup + frequency -------------------------------------

test('distinctAnswers groups answers case- and whitespace-insensitively', () => {
  seedAnswers(KEY, ['Hyvä ruoka', 'hyvä  ruoka', 'HYVÄ RUOKA ']);
  const rows = JSON.parse(distinct(KEY));
  assert.equal(rows.length, 1, 'three spellings of one answer collapse to one row');
  assert.equal(rows[0].count, 3);
});

test('distinctAnswers displays the first-seen casing of a group', () => {
  seedAnswers(KEY, ['hyvä ruoka', 'Hyvä Ruoka', 'HYVÄ RUOKA']);
  const rows = JSON.parse(distinct(KEY));
  assert.equal(rows[0].text, 'hyvä ruoka');
});

test('distinctAnswers skips blank and whitespace-only answers', () => {
  seedAnswers(KEY, ['musiikki', '', '   ', '\t\n', 'musiikki']);
  const rows = JSON.parse(distinct(KEY));
  assert.deepEqual(texts(rows), ['musiikki']);
  assert.equal(rows[0].count, 2);
});

test('distinctAnswers sorts by descending frequency', () => {
  seedAnswers(KEY, ['ruoka', 'musiikki', 'musiikki', 'sää', 'musiikki', 'ruoka']);
  const rows = JSON.parse(distinct(KEY));
  assert.deepEqual(texts(rows), ['musiikki', 'ruoka', 'sää']);
  assert.deepEqual(rows.map(r => r.count), [3, 2, 1]);
});

test('distinctAnswers reads only the requested question', () => {
  run(`forms = [blankForm(), blankForm()];
       forms[0].free[${JSON.stringify(KEY)}] = 'ruoka';
       forms[1].free[${JSON.stringify(OTHER_KEY)}] = 'jonotus';`);
  assert.deepEqual(texts(JSON.parse(distinct(KEY))), ['ruoka']);
  assert.deepEqual(texts(JSON.parse(distinct(OTHER_KEY))), ['jonotus']);
});

// --- suggestionsFor: ranking ------------------------------------------------

test('empty input offers the most common answers first', () => {
  seedAnswers(KEY, ['ruoka', 'musiikki', 'musiikki', 'sää']);
  assert.deepEqual(texts(suggest(KEY, '')), ['musiikki', 'ruoka', 'sää']);
  assert.deepEqual(texts(suggest(KEY, '   ')), ['musiikki', 'ruoka', 'sää'],
    'whitespace-only input counts as empty');
});

test('suggestions are capped at six', () => {
  seedAnswers(KEY, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
  assert.equal(suggest(KEY, '').length, 6);
  assert.equal(suggest(KEY, 'a').length, 6, 'the cap also applies to a matched query');
});

test('a substring match outranks a merely-fuzzy one', () => {
  seedAnswers(KEY, ['hyvä musiikki', 'musikki']);
  const rows = suggest(KEY, 'musiikki');
  assert.equal(rows[0].text, 'hyvä musiikki',
    'the substring boost puts the containing answer first');
  assert.ok(rows.length > 1, 'the near-miss spelling is still offered');
});

test('answers below the similarity threshold are dropped', () => {
  seedAnswers(KEY, ['musiikki', 'jonotus']);
  assert.deepEqual(texts(suggest(KEY, 'musiikki')), ['musiikki'],
    'an unrelated answer scores under 0.2 and is filtered out');
});

test('the 0.2 threshold admits answers that merely share bigrams', () => {
  // Characterizes a real cost of bigram similarity, not a bug to fix here:
  // "parkkipaikat" shares kk/ki/ik with "musiikki" and scores 0.33, so it is
  // offered even though it is an unrelated answer. Tightening the threshold
  // trades these false positives against missed near-miss spellings — the same
  // precision/recall call parked in idea #1662.
  seedAnswers(KEY, ['musiikki', 'parkkipaikat']);
  assert.deepEqual(texts(suggest(KEY, 'musiikki')), ['musiikki', 'parkkipaikat']);
});

test('equal scores are broken by frequency', () => {
  seedAnswers(KEY, ['ruokaa', 'ruokaa', 'ruokab']);
  const rows = suggest(KEY, 'ruoka');
  assert.deepEqual(texts(rows), ['ruokaa', 'ruokab']);
  assert.equal(rows[0].count, 2);
});

test('a one-character query still matches by substring', () => {
  // Single characters produce no bigrams, so dice() alone scores 0 (the known
  // limitation characterized in palaute-dice.test.mjs); the substring boost is
  // what keeps a one-key query useful.
  seedAnswers(KEY, ['musiikki', 'ruoka']);
  assert.deepEqual(texts(suggest(KEY, 'm')), ['musiikki']);
});

test('a query matching nothing returns no suggestions', () => {
  seedAnswers(KEY, ['musiikki', 'ruoka']);
  assert.deepEqual(suggest(KEY, 'zzzzzz'), []);
});

test('suggestions carry the frequency the picker shows', () => {
  seedAnswers(KEY, ['musiikki', 'musiikki', 'musiikki']);
  assert.equal(suggest(KEY, 'musi')[0].count, 3);
});

// --- cloneForm / escapeHtml -------------------------------------------------

test('cloneForm is a deep copy, so editing a form cannot mutate the saved one', () => {
  run(`forms = [blankForm()];
       forms[0].free[${JSON.stringify(KEY)}] = 'alkuperäinen';
       forms[0].ratings[0] = 5;
       const copy = cloneForm(forms[0]);
       copy.free[${JSON.stringify(KEY)}] = 'muokattu';
       copy.ratings[0] = 1;
       globalThis.__original = JSON.stringify(forms[0]);`);
  const original = JSON.parse(run('__original;'));
  assert.equal(original.free[KEY], 'alkuperäinen');
  assert.equal(original.ratings[0], 5);
});

test('escapeHtml neutralises every character that could break out of markup', () => {
  assert.equal(run(`escapeHtml('<script>alert(1)</script>');`),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(run(`escapeHtml('a & b');`), 'a &amp; b');
  assert.equal(run(`escapeHtml('he said "hi"');`), 'he said &quot;hi&quot;');
  assert.equal(run(`escapeHtml("it's");`), 'it&#39;s');
  assert.equal(run(`escapeHtml('" onmouseover=x');`), '&quot; onmouseover=x');
});

test('escapeHtml turns a missing value into an empty string, not "undefined"', () => {
  assert.equal(run('escapeHtml(undefined);'), '');
  assert.equal(run('escapeHtml(null);'), '');
  assert.equal(run(`escapeHtml('');`), '');
});
