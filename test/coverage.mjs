// Aggregate NODE_V8_COVERAGE for vm-loaded page scripts; fail below the floor.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAGES = ['palaute.html', 'yatzy.html'];

// Current measured function-entry rate, rounded down: palaute 144/145 = 99.3%,
// yatzy 102/107 = 95.3%. A ratchet, not a target: raise it when coverage rises.
// A one-function drop fails both (palaute 143/145 = 98.6%, yatzy 101/107 = 94.4%).
export const FLOORS = {
  'palaute.html': 99,
  'yatzy.html': 95,
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
      const count = fn?.ranges?.[0]?.count || 0;
      const key = functionKey(fn);
      map.set(key, Math.max(map.get(key) ?? 0, count));
    }
  }
  return PAGES.map((page) => {
    const map = byPage[page];
    const total = map.size;
    const entered = [...map.values()].filter((c) => c > 0).length;
    const pct = percent(entered, total);
    const floor = FLOORS[page];
    return { page, entered, total, pct, floor, ok: total > 0 && pct >= floor };
  });
}

export function formatReport(rows) {
  const lines = ['page          entered  total   pct   floor  status'];
  for (const r of rows) {
    const status = r.ok ? 'ok' : 'FAIL';
    const pct = r.pct.toFixed(1).padStart(4);
    lines.push(
      `${r.page.padEnd(14)}${String(r.entered).padStart(7)}  ${String(r.total).padStart(5)}  ${pct}%  ${String(r.floor).padStart(4)}%  ${status}`,
    );
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
      io.error(`coverage below floor (need ${PAGES.map((p) => `${p} ≥ ${FLOORS[p]}%`).join(', ')})`);
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
