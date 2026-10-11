// Aggregate NODE_V8_COVERAGE for vm-loaded page scripts; fail below the floors.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAGES = ['palaute.html', 'yatzy.html'];

// Current measured function-entry rate, rounded down: palaute 160/160 = 100%,
// yatzy 104/109 = 95.4%. A ratchet, not a target: raise it when coverage rises.
// A one-function drop fails both (palaute 159/160 = 99.4%, yatzy 103/109 = 94.5%).
export const FLOORS = {
  'palaute.html': 100,
  'yatzy.html': 95,
};

// Current measured block rate, rounded down: palaute 423/431 = 98.1%,
// yatzy 310/329 = 94.2%. A one-block drop fails both
// (palaute 422/431 = 97.9%, yatzy 309/329 = 93.9%). V8 sometimes omits one
// covered range in yatzy calculateScore (309/328); that snapshot rounds down to 94 too.
export const BLOCK_FLOORS = {
  'palaute.html': 98,
  'yatzy.html': 94,
};

export function percent(entered, total) {
  if (!total) return 0;
  return Math.round((1000 * entered) / total) / 10;
}

export function pageFromUrl(url) {
  const s = String(url);
  for (const page of PAGES) {
    if (s.includes(`${page}#script`)) return page;
  }
  return null;
}

function functionKey(fn) {
  const range = fn?.ranges?.[0] || {};
  return `${fn?.functionName ?? ''}:${range.startOffset}:${range.endOffset}`;
}

function rangesOf(fn) {
  return Array.isArray(fn?.ranges) ? fn.ranges : [];
}

// Tightest range in this file that contains [start, end], or null when none does.
// V8 omits a range whose count matches the range around it, so a missing range
// inherits that parent instead of counting as a gap.
function enclosingCount(ranges, start, end) {
  let best = null;
  let bestSpan = Infinity;
  for (const range of ranges) {
    const rangeStart = range?.startOffset;
    const rangeEnd = range?.endOffset;
    if (typeof rangeStart !== 'number' || typeof rangeEnd !== 'number') continue;
    if (rangeStart <= start && rangeEnd >= end) {
      const span = rangeEnd - rangeStart;
      if (span < bestSpan) {
        bestSpan = span;
        best = range;
      }
    }
  }
  return best ? (best.count || 0) : null;
}

function blockCoverage(rangeSets) {
  const seen = new Map();
  for (const ranges of rangeSets) {
    for (const range of ranges) {
      if (typeof range?.startOffset !== 'number' || typeof range?.endOffset !== 'number') continue;
      seen.set(`${range.startOffset}:${range.endOffset}`, range);
    }
  }
  let covered = 0;
  for (const range of seen.values()) {
    let enclosed = false;
    let hit = false;
    for (const ranges of rangeSets) {
      const count = enclosingCount(ranges, range.startOffset, range.endOffset);
      if (count == null) continue;
      enclosed = true;
      if (count > 0) {
        hit = true;
        break;
      }
    }
    if (enclosed && hit) covered += 1;
  }
  return { covered, total: seen.size };
}

export function readCoverageFiles(dir) {
  if (!existsSync(dir)) {
    throw new Error(`no V8 coverage directory at ${dir}`);
  }
  const names = readdirSync(dir).filter((n) => /^coverage-.*\.json$/.test(n));
  if (names.length === 0) {
    throw new Error(`no coverage-*.json files in ${dir}`);
  }
  const scripts = [];
  for (const name of names) {
    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (err) {
      throw new Error(`unreadable coverage file ${name}: ${err.message}`);
    }
    if (!Array.isArray(data?.result)) {
      throw new Error(`coverage file ${name} has no result array`);
    }
    for (const script of data.result) scripts.push(script);
  }
  return scripts;
}

export function summarize(dir) {
  const byPage = Object.fromEntries(PAGES.map((p) => [p, new Map()]));
  for (const script of readCoverageFiles(dir)) {
    const page = pageFromUrl(script?.url);
    if (!page) continue;
    const map = byPage[page];
    for (const fn of script.functions || []) {
      const ranges = rangesOf(fn);
      const key = functionKey(fn);
      let entry = map.get(key);
      if (!entry) {
        entry = { count: 0, rangeSets: [] };
        map.set(key, entry);
      }
      entry.count = Math.max(entry.count, ranges[0]?.count || 0);
      entry.rangeSets.push(ranges);
    }
  }
  return PAGES.map((page) => {
    const map = byPage[page];
    const total = map.size;
    const entered = [...map.values()].filter((entry) => entry.count > 0).length;
    const pct = percent(entered, total);
    const floor = FLOORS[page];
    let blocks = 0;
    let blockTotal = 0;
    for (const entry of map.values()) {
      const block = blockCoverage(entry.rangeSets);
      blocks += block.covered;
      blockTotal += block.total;
    }
    const blockPct = percent(blocks, blockTotal);
    const blockFloor = BLOCK_FLOORS[page];
    const fnOk = total > 0 && pct >= floor;
    const blockOk = blockTotal > 0 && blockPct >= blockFloor;
    return {
      page, entered, total, pct, floor,
      blocks, blockTotal, blockPct, blockFloor,
      ok: fnOk && blockOk,
    };
  });
}

function statusOf(row) {
  if (row.ok) return 'ok';
  const fnOk = row.total > 0 && row.pct >= row.floor;
  const blockOk = row.blockTotal > 0 && row.blockPct >= row.blockFloor;
  if (!fnOk && !blockOk) return 'FAIL';
  if (!fnOk) return 'FAIL functions';
  return 'FAIL blocks';
}

export function formatReport(rows) {
  const lines = [
    'page          fn hit  fn tot   fn %  fn floor  blk hit  blk tot   blk %  blk floor  status',
  ];
  for (const r of rows) {
    const pct = r.pct.toFixed(1).padStart(5);
    const blockPct = r.blockPct.toFixed(1).padStart(5);
    lines.push([
      r.page.padEnd(13),
      String(r.entered).padStart(6),
      String(r.total).padStart(6),
      `${pct}%`,
      `${String(r.floor).padStart(7)}%`,
      String(r.blocks).padStart(7),
      String(r.blockTotal).padStart(7),
      `${blockPct}%`,
      `${String(r.blockFloor).padStart(8)}%`,
      statusOf(r),
    ].join('  '));
  }
  return lines.join('\n');
}

export function coverageDirFromArgs(argv = process.argv, env = process.env) {
  return argv[2] || env.NODE_V8_COVERAGE || '.coverage';
}

export function main(argv = process.argv, env = process.env, io = console) {
  const dir = coverageDirFromArgs(argv, env);
  try {
    const rows = summarize(dir);
    io.log(formatReport(rows));
    if (rows.some((r) => !r.ok)) {
      const need = PAGES.map((p) => `${p} functions ≥ ${FLOORS[p]}%, blocks ≥ ${BLOCK_FLOORS[p]}%`).join('; ');
      io.error(`coverage below floor (need ${need})`);
      return 1;
    }
    return 0;
  } catch (err) {
    io.error(`coverage: ${err.message}`);
    io.error('hint: NODE_V8_COVERAGE=.coverage node --test test/*.test.mjs && node test/coverage.mjs');
    return 1;
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain && !process.env.NODE_TEST_CONTEXT) {
  process.exit(main());
}
