// CSP + ExcelJS SRI pin (audit #8968): CLAUDE.md pins palaute.html's script-src
// to 'self' 'unsafe-inline' plus cdnjs, yatzy.html's to 'self' 'unsafe-inline'
// only, and palaute's ExcelJS tag as SRI-pinned to the version named in
// docs/exceljs.md. Nothing else in the suite reads the HTML as text, so a
// widened script-src, a dropped CSP meta, or a URL/docs version drift would
// ship silently. Same static-markup shape as test/yatzy-bonus.test.mjs's
// Bonus Target card vs UPPER_BONUS_THRESHOLD.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const palauteHtml = readFileSync(join(here, '..', 'palaute.html'), 'utf8');
const yatzyHtml = readFileSync(join(here, '..', 'yatzy.html'), 'utf8');
const exceljsDoc = readFileSync(join(here, '..', 'docs', 'exceljs.md'), 'utf8');

function cspContent(html, file) {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/);
  assert.ok(m, `${file} must keep a Content-Security-Policy meta tag`);
  return m[1];
}

test("palaute.html's CSP script-src is 'self' 'unsafe-inline' plus cdnjs, exactly", () => {
  assert.equal(
    cspContent(palauteHtml, 'palaute.html'),
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
  );
});

test("yatzy.html's CSP script-src is 'self' 'unsafe-inline' only, exactly", () => {
  assert.equal(
    cspContent(yatzyHtml, 'yatzy.html'),
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'",
  );
});

test("palaute.html's EXCELJS_URL version matches the version named in docs/exceljs.md", () => {
  const url = palauteHtml.match(/EXCELJS_URL = "([^"]+)"/);
  assert.ok(url, 'EXCELJS_URL constant is present');
  const version = url[1].match(/\/exceljs\/(\d+\.\d+\.\d+)\//);
  assert.ok(version, `EXCELJS_URL names an exceljs version segment: ${url[1]}`);
  assert.match(
    exceljsDoc,
    new RegExp(`ExcelJS ${version[1].replaceAll('.', '\\.')}`),
    `docs/exceljs.md must name ExcelJS ${version[1]} so a URL bump cannot drift from the doc`,
  );
});

test('palaute.html assigns EXCELJS_SRI and anonymous crossOrigin on the injected script', () => {
  assert.match(palauteHtml, /s\.integrity = EXCELJS_SRI/);
  assert.match(palauteHtml, /s\.crossOrigin = "anonymous"/);
});
