// Block-range coverage: a gap counts only when every file's enclosing range is 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './coverage.mjs';
import { functionsWithBlocks, runMain, runShaped, writeDir } from './coverage-fixture.mjs';

test('main exits 0 at the measured block rates (423/431 and 310/329)', () => {
  const dir = writeDir({
    'coverage-a.json': [
      { url: 'palaute.html#script', functions: functionsWithBlocks(160, 160, 423, 431) },
      { url: 'yatzy.html#script', functions: functionsWithBlocks(104, 109, 310, 329) },
    ],
  });
  const { code, out } = runMain(dir);
  assert.equal(code, 0, out);
});

test('a one-block palaute drop fails while every function was entered (422/431 < 98)', () => {
  const { code, out, err } = runShaped('palaute.html', 160, 160, 422, 431);
  assert.equal(code, 1);
  assert.match(out, /palaute\.html .*FAIL/);
  assert.match(err, /blocks ≥ 98%/);
});

test('a one-block yatzy drop fails while function entry still clears its floor (309/329 < 94)', () => {
  const { code, out, err } = runShaped('yatzy.html', 104, 109, 309, 329);
  assert.equal(code, 1);
  assert.match(out, /yatzy\.html .*FAIL/);
  assert.match(err, /blocks ≥ 94%/);
});

test('a block range omitted from one file inherits that file\'s enclosing count', () => {
  const dir = writeDir({
    'coverage-a.json': [{
      url: 'yatzy.html#script',
      functions: [{
        functionName: 'f',
        ranges: [{ startOffset: 0, endOffset: 100, count: 1 }],
      }],
    }],
    'coverage-b.json': [{
      url: 'yatzy.html#script',
      functions: [{
        functionName: 'f',
        ranges: [
          { startOffset: 0, endOffset: 100, count: 4 },
          { startOffset: 10, endOffset: 50, count: 0 },
          { startOffset: 20, endOffset: 30, count: 0 },
        ],
      }],
    }],
  });
  const yatzy = summarize(dir).find((r) => r.page === 'yatzy.html');
  assert.equal(yatzy.entered, 1);
  assert.equal(yatzy.total, 1);
  assert.equal(yatzy.blocks, 3);
  assert.equal(yatzy.blockTotal, 3);
});

test('a block is uncovered only when every file enclosing it counted 0', () => {
  const dir = writeDir({
    'coverage-a.json': [{
      url: 'palaute.html#script',
      functions: [{
        functionName: 'f',
        ranges: [
          { startOffset: 0, endOffset: 100, count: 1 },
          { startOffset: 10, endOffset: 50, count: 0 },
        ],
      }],
    }],
    'coverage-b.json': [{
      url: 'palaute.html#script',
      functions: [{
        functionName: 'f',
        ranges: [
          { startOffset: 0, endOffset: 100, count: 2 },
          { startOffset: 10, endOffset: 50, count: 0 },
          { startOffset: 20, endOffset: 30, count: 0 },
        ],
      }],
    }],
  });
  const palaute = summarize(dir).find((r) => r.page === 'palaute.html');
  assert.equal(palaute.blocks, 1);
  assert.equal(palaute.blockTotal, 3);
});

test('a sibling function range does not cover another function\'s block', () => {
  const dir = writeDir({
    'coverage-a.json': [{
      url: 'yatzy.html#script',
      functions: [
        {
          functionName: 'outer',
          ranges: [{ startOffset: 0, endOffset: 200, count: 5 }],
        },
        {
          functionName: 'inner',
          ranges: [
            { startOffset: 40, endOffset: 80, count: 0 },
            { startOffset: 50, endOffset: 60, count: 0 },
          ],
        },
      ],
    }],
  });
  const yatzy = summarize(dir).find((r) => r.page === 'yatzy.html');
  assert.equal(yatzy.entered, 1);
  assert.equal(yatzy.total, 2);
  assert.equal(yatzy.blocks, 1);
  assert.equal(yatzy.blockTotal, 3);
  assert.equal(yatzy.ok, false);
});
