// Fixture builders for the coverage-gate tests.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './coverage.mjs';

const cli = join(dirname(fileURLToPath(import.meta.url)), 'coverage.mjs');

export function fn(name, start, end, count) {
  return {
    functionName: name,
    ranges: [{ startOffset: start, endOffset: end, count }],
    isBlockCoverage: true,
  };
}

export function mix(entered, total, prefix) {
  return Array.from({ length: total }, (_, i) =>
    fn(`${prefix}${i}`, i, i + 1, i < entered ? 1 : 0),
  );
}

// Extra ranges are inner blocks on the first entered function, so a block gap
// can sit inside a function the entry-rate already counts as covered.
export function functionsWithBlocks(fnEntered, fnTotal, blockCovered, blockTotal) {
  const innerTotal = blockTotal - fnTotal;
  const uncoveredOuters = fnTotal - fnEntered;
  const uncoveredInners = blockTotal - blockCovered - uncoveredOuters;
  if (innerTotal < 0 || uncoveredInners < 0 || uncoveredInners > innerTotal) {
    throw new Error(
      `impossible coverage shape functions ${fnEntered}/${fnTotal} blocks ${blockCovered}/${blockTotal}`,
    );
  }
  const host = fnEntered > 0 ? 0 : null;
  const fns = [];
  for (let i = 0; i < fnTotal; i++) {
    const base = i * 1000;
    const ranges = [{ startOffset: base, endOffset: base + 999, count: i < fnEntered ? 1 : 0 }];
    if (i === host) {
      const coveredInners = innerTotal - uncoveredInners;
      for (let j = 0; j < innerTotal; j++) {
        const start = base + 1 + j * 2;
        ranges.push({ startOffset: start, endOffset: start + 1, count: j < coveredInners ? 1 : 0 });
      }
    }
    fns.push({ functionName: `f${i}`, ranges, isBlockCoverage: true });
  }
  return fns;
}

export function writeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-cov-'));
  for (const [name, result] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify({ result }));
  }
  return dir;
}

export function runMain(dir) {
  const logs = [];
  const errs = [];
  const code = main(['node', cli, dir], {}, {
    log: (s) => logs.push(String(s)),
    error: (s) => errs.push(String(s)),
  });
  return { code, out: logs.join('\n'), err: errs.join('\n') };
}

// One page at `[entered, total]` functions (one range each), the other at its measured rate.
export function runAt(page, entered, total) {
  const rates = { 'yatzy.html': [105, 109], 'palaute.html': [160, 160], [page]: [entered, total] };
  return runMain(writeDir({
    'coverage-a.json': Object.entries(rates).map(([p, [e, t]]) =>
      ({ url: `${p}#script`, functions: mix(e, t, p[0]) })),
  }));
}

// One page at a function rate and a block rate; the other page stays at its measured function rate.
export function runShaped(page, fnEntered, fnTotal, blockCovered, blockTotal) {
  const other = page === 'yatzy.html' ? 'palaute.html' : 'yatzy.html';
  const otherFn = other === 'yatzy.html' ? [105, 109] : [160, 160];
  return runMain(writeDir({
    'coverage-a.json': [
      {
        url: `${page}#script`,
        functions: functionsWithBlocks(fnEntered, fnTotal, blockCovered, blockTotal),
      },
      { url: `${other}#script`, functions: mix(otherFn[0], otherFn[1], other[0]) },
    ],
  }));
}

export const coverageCli = cli;
