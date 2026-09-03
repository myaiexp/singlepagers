// Tests for the NODE_V8_COVERAGE page-script coverage gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOORS, main, percent, summarize } from './coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'coverage.mjs');

function fn(name, start, end, count) {
  return {
    functionName: name,
    ranges: [{ startOffset: start, endOffset: end, count }],
    isBlockCoverage: true,
  };
}

function mix(entered, total, prefix) {
  return Array.from({ length: total }, (_, i) =>
    fn(`${prefix}${i}`, i, i + 1, i < entered ? 1 : 0),
  );
}

function writeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cov-'));
  for (const [name, result] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify({ result }));
  }
  return dir;
}

function runMain(dir) {
  const logs = [];
  const errs = [];
  const code = main(['node', cli, dir], {}, {
    log: (s) => logs.push(String(s)),
    error: (s) => errs.push(String(s)),
  });
  return { code, out: logs.join('\n'), err: errs.join('\n') };
}

test('percent rounds to one decimal (121/137 = 88.3, 90/97 = 92.8)', () => {
  assert.equal(percent(121, 137), 88.3);
  assert.equal(percent(90, 97), 92.8);
  assert.equal(percent(120, 137), 87.6);
  assert.equal(percent(89, 97), 91.8);
  assert.equal(percent(0, 0), 0);
});

test('FLOORS start at the current rates, rounded down', () => {
  assert.equal(FLOORS['palaute.html'], 88);
  assert.equal(FLOORS['yatzy.html'], 92);
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
  assert.equal(yatzy.ok, true);
  const palaute = rows.find((r) => r.page === 'palaute.html');
  assert.equal(palaute.entered, 20);
  assert.equal(palaute.total, 20);
});

test('summarize fails a page that is absent (vacuous 100% over zero files is a miss)', () => {
  const dir = writeDir({
    'coverage-a.json': [{ url: 'yatzy.html#script', functions: mix(90, 96, 'y') }],
  });
  const palaute = summarize(dir).find((r) => r.page === 'palaute.html');
  assert.equal(palaute.total, 0);
  assert.equal(palaute.entered, 0);
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

test('main exits 0 at the current rates (121/137 and 90/97)', () => {
  const dir = writeDir({
    'coverage-a.json': [
      { url: 'yatzy.html#script', functions: mix(90, 97, 'y') },
      { url: 'palaute.html#script', functions: mix(121, 137, 'p') },
    ],
  });
  const { code, out } = runMain(dir);
  assert.equal(code, 0, out);
  assert.match(out, /yatzy\.html/);
  assert.match(out, /palaute\.html/);
});

test('main exits 1 on a one-function drop below either floor', () => {
  const dir = writeDir({
    'coverage-a.json': [
      { url: 'yatzy.html#script', functions: mix(89, 97, 'y') },
      { url: 'palaute.html#script', functions: mix(120, 137, 'p') },
    ],
  });
  const { code } = runMain(dir);
  assert.equal(code, 1);
});

test('node test/coverage.mjs exits 1 on a missing dir (documented CLI)', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [cli, join(tmpdir(), 'no-such-sp-cov-dir')], {
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 1);
  assert.match(`${r.stderr}${r.stdout}`, /no V8 coverage directory/);
});
