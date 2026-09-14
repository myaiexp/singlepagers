// Render-path HTML escaping (audit #8958): palaute-suggestions.test.mjs covers
// escapeHtml in isolation, which is why reducing it to identity, or dropping
// the helper at the renderReview / freetextHTML / raffleHTML call sites, all
// passed the suite. Same mutation-proof shape as palaute-labels.test.mjs —
// seed user-controlled fields with a payload and assert the innerHTML the
// render functions actually write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './dom-stub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const palautePath = join(here, '..', 'palaute.html');

const IMG = '<img src=x onerror=alert(1)>';
const ATTR = '" onmouseover=x';

function loadPalaute() {
  const { run } = loadPage(palautePath);
  return { run };
}

function assertEscaped(html, label) {
  assert.match(html, /&lt;img/, `${label} escapes < to &lt; so the img payload cannot become a tag`);
  assert.match(html, /&quot;/, `${label} escapes " so an attribute cannot break out`);
  assert.doesNotMatch(html, /<img/, `${label} must not emit a raw <img tag`);
}

test('renderReview escapes free-text snippets (not raw innerHTML)', () => {
  const { run } = loadPalaute();
  // snip is `best || improve || open || topics` — both payloads must live in
  // that first field or the quote-breakout never reaches the HTML.
  run(`forms = [{
    id: 'xss-1', attendance: 'both', ratings: [5, 4, 3, 2, 1, 5, 4],
    recommend: 'kylla',
    free: { best: ${JSON.stringify(IMG + ATTR)}, improve: '', topics: '', open: '' },
    name: ${JSON.stringify(ATTR)}, phone: ${JSON.stringify(IMG)},
  }];
  renderReview();`);
  const html = run('reviewEl.innerHTML');
  assertEscaped(html, 'renderReview');
});

// load() accepts any JSON array, so a crafted row id reaches the data-edit /
// data-del attributes verbatim (finding #10359). The snippet test above uses a
// safe id, which is why dropping escapeHtml(f.id) used to stay green.
test('renderReview escapes form ids inside data-edit / data-del', () => {
  const { run } = loadPalaute();
  const id = IMG + ATTR;
  run(`forms = [{
    id: ${JSON.stringify(id)}, attendance: 'both', ratings: [5, 4, 3, 2, 1, 5, 4],
    recommend: 'kylla', free: { best: '', improve: '', topics: '', open: '' },
    name: '', phone: '',
  }];
  renderReview();`);
  const html = run('reviewEl.innerHTML');
  const escaped = '&lt;img src=x onerror=alert(1)&gt;&quot; onmouseover=x';
  assert.ok(html.includes(`data-edit="${escaped}"`), 'data-edit carries the escaped id');
  assert.ok(html.includes(`data-del="${escaped}"`), 'data-del carries the escaped id');
  assert.doesNotMatch(html, /<img/, 'the id must not emit a raw <img tag');
  assert.doesNotMatch(html, /" onmouseover=/, 'the id must not break out of its attribute');
});

test('renderEntry escapes free-text, name, and phone into the form markup', () => {
  const { run } = loadPalaute();
  run(`current = blankForm();
       current.free.best = ${JSON.stringify(IMG)};
       current.free.open = ${JSON.stringify(ATTR)};
       current.name = ${JSON.stringify(ATTR)};
       current.phone = ${JSON.stringify(IMG)};
       renderEntry();`);
  const html = run('entryEl.innerHTML');
  assertEscaped(html, 'renderEntry');
  assert.match(html, /value="&quot; onmouseover=x"/,
    'raffle name is escaped inside the value attribute');
  assert.doesNotMatch(html, /value="" onmouseover=/,
    'an unescaped quote must not break out of the name/phone value attribute');
});
