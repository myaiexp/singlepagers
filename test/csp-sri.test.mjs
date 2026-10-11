// CSP + ExcelJS SRI pin (audit #8968): CLAUDE.md pins palaute.html's script-src
// to 'self' 'unsafe-inline' plus cdnjs, yatzy.html's to 'self' 'unsafe-inline'
// only, and palaute's ExcelJS tag as SRI-pinned to the version named in
// docs/exceljs.md. Nothing else in the suite reads the HTML as text, so a
// widened script-src, a dropped CSP meta, or a URL/docs version drift would
// ship silently. Same static-markup shape as test/yatzy-bonus.test.mjs's
// Bonus Target card vs UPPER_BONUS_THRESHOLD.
//
// The mase.fi nginx sub_filter injects the Cloudflare Insights beacon into
// every HTML response. The comment beside each CSP meta must say that host
// stays blocked (finding #12305). Allowlisting it to silence the console
// violation would put third-party code on palaute.html.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, PALAUTE_PATH, YATZY_PATH } from './pages.mjs';

const palauteHtml = readFileSync(PALAUTE_PATH, 'utf8');
const yatzyHtml = readFileSync(YATZY_PATH, 'utf8');
const exceljsDoc = readFileSync(join(REPO_ROOT, 'docs', 'exceljs.md'), 'utf8');

function cspContent(html, file) {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)">/);
  assert.ok(m, `${file} must keep a Content-Security-Policy meta tag`);
  return m[1];
}

// The comment that ends immediately before the CSP meta. An earlier comment in
// the file must not satisfy the beacon warning — that warning has to sit where
// someone editing the policy will read it.
function cspComment(html, file) {
  const metaAt = html.search(/<meta\s+http-equiv="Content-Security-Policy"/);
  assert.ok(metaAt >= 0, `${file} must keep a CSP meta tag`);
  const before = html.slice(0, metaAt);
  assert.match(before, /-->\s*$/, `${file} CSP meta must sit immediately after its explanation comment`);
  const comments = [...before.matchAll(/<!--([\s\S]*?)-->/g)];
  assert.ok(comments.length > 0, `${file} must explain the CSP in a comment`);
  return comments[comments.length - 1][1];
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

// The exact CSP strings above already fail an allowlist edit. This pins the
// warning next to the tag, so deleting the explanation and "updating the test
// to match" a wider policy are two separate failures.
test('CSP comments name the injected Cloudflare beacon and say it must stay blocked', () => {
  for (const [file, html] of [['palaute.html', palauteHtml], ['yatzy.html', yatzyHtml]]) {
    const comment = cspComment(html, file);
    assert.match(
      comment,
      /static\.cloudflareinsights\.com/,
      `${file} must name the injected beacon host`,
    );
    assert.match(
      comment,
      /must keep blocking/,
      `${file} must say the meta CSP has to keep blocking the beacon`,
    );
    assert.doesNotMatch(
      cspContent(html, file),
      /cloudflareinsights/,
      `${file} CSP must not allowlist the beacon`,
    );
  }
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
