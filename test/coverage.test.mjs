// Tests for the NODE_V8_COVERAGE page-script coverage gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCK_FLOORS, FLOORS, percent, summarize } from './coverage.mjs';
import { coverageCli, fn, mix, runAt, runMain, writeDir } from './coverage-fixture.mjs';

test('percent rounds to one decimal', () => {
  assert.equal(percent(160, 160), 100);
  assert.equal(percent(159, 160), 99.4);
  assert.equal(percent(105, 109), 96.3);
  assert.equal(percent(104, 109), 95.4);
  assert.equal(percent(103, 109), 94.5);
  assert.equal(percent(423, 431), 98.1);
  assert.equal(percent(422, 431), 97.9);
  assert.equal(percent(309, 328), 94.2);
  assert.equal(percent(315, 333), 94.6);
  assert.equal(percent(314, 333), 94.3);
  assert.equal(percent(310, 329), 94.2);
  assert.equal(percent(309, 329), 93.9);
  assert.equal(percent(0, 0), 0);
});

test('FLOORS pin palaute at 100 and yatzy at 96', () => {
  assert.equal(FLOORS['palaute.html'], 100);
  assert.equal(FLOORS['yatzy.html'], 96);
});

test('BLOCK_FLOORS pin palaute at 98 and yatzy at 94', () => {
  assert.equal(BLOCK_FLOORS['palaute.html'], 98);
  assert.equal(BLOCK_FLOORS['yatzy.html'], 94);
});

test('summarize merges #script entries across files and ignores other urls', () => {
  const dir = writeDir({
    'coverage-a.json': [
      { url: 'yatzy.html#script', functions: [fn('hit', 0, 10, 1), fn('miss', 10, 20, 0)] },
      { url: 'file:///tmp/test/yatzy-turn.test.mjs', functions: [fn('testfn', 0, 5, 1)] },
    ],
    'coverage-b.json': [
      { url: 'yatzy.html#script', functions: [fn('hit', 0, 10, 0), fn('miss', 10, 20, 1), fn('other', 20, 30, 1)] },
      { url: 'palaute.html#script', functions: mix(20, 20, 'p') },
    ],
  });
  const rows = summarize(dir);
  const yatzy = rows.find((r) => r.page === 'yatzy.html');
  assert.equal(yatzy.entered, 3);
  assert.equal(yatzy.total, 3);
  assert.equal(yatzy.blocks, 3);
  assert.equal(yatzy.blockTotal, 3);
  assert.equal(yatzy.ok, true);
  const palaute = rows.find((r) => r.page === 'palaute.html');
  assert.equal(palaute.entered, 20);
  assert.equal(palaute.total, 20);
  assert.equal(palaute.blocks, 20);
  assert.equal(palaute.blockTotal, 20);
});

test('summarize fails a page that is absent (vacuous 100% over zero files is a miss)', () => {
  const dir = writeDir({
    'coverage-a.json': [{ url: 'yatzy.html#script', functions: mix(90, 96, 'y') }],
  });
  const palaute = summarize(dir).find((r) => r.page === 'palaute.html');
  assert.equal(palaute.total, 0);
  assert.equal(palaute.entered, 0);
  assert.equal(palaute.blockTotal, 0);
  assert.equal(palaute.blocks, 0);
  assert.equal(palaute.ok, false);
});

test('main exits 1 when the coverage dir is missing', () => {
  const { code, err } = runMain(join(tmpdir(), 'no-such-sp-cov-dir'));
  assert.equal(code, 1);
  assert.match(err, /no V8 coverage directory/);
});

test('main exits 1 below the floor', () => {
  const dir = writeDir({
    'coverage-a.json': [
      { url: 'yatzy.html#script', functions: mix(1, 10, 'y') },
      { url: 'palaute.html#script', functions: mix(1, 10, 'p') },
    ],
  });
  const { code, err } = runMain(dir);
  assert.equal(code, 1);
  assert.match(err, /below floor/);
});

test('main exits 0 at the measured rates (160/160 and 105/109)', () => {
  const dir = writeDir({
    'coverage-a.json': [
      { url: 'yatzy.html#script', functions: mix(105, 109, 'y') },
      { url: 'palaute.html#script', functions: mix(160, 160, 'p') },
    ],
  });
  const { code, out } = runMain(dir);
  assert.equal(code, 0, out);
  assert.match(out, /yatzy\.html/);
  assert.match(out, /palaute\.html/);
});

test('main exits 1 on a one-function yatzy drop (104/109 < 96)', () => {
  const { code, out } = runAt('yatzy.html', 104, 109);
  assert.equal(code, 1);
  assert.match(out, /yatzy\.html .*FAIL/);
});

test('a one-function palaute drop fails (159/160 < 100)', () => {
  const { code, out } = runAt('palaute.html', 159, 160);
  assert.equal(code, 1);
  assert.match(out, /palaute\.html .*FAIL/);
});

test('node test/coverage.mjs exits 1 on a missing dir (documented CLI)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [coverageCli, join(tmpdir(), 'no-such-sp-cov-dir')], {
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 1);
  assert.match(`${r.stderr}${r.stdout}`, /no V8 coverage directory/);
});
