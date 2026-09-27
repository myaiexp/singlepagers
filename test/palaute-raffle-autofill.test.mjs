// Raffle contact fields stay out of the browser's autofill store (audit
// finding #10341): clearAll only wipes localStorage, so a name or phone the
// browser saved for autofill would be offered to the next operator on the
// shared venue profile after the page reported the forms gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './dom-stub.mjs';
import { PALAUTE_PATH } from './pages.mjs';

function raffleHtml() {
  const { run } = loadPage(PALAUTE_PATH);
  return run('raffleHTML()');
}

test('raffle name and phone inputs opt out of browser autofill', () => {
  const html = raffleHtml();
  for (const id of ['r-name', 'r-phone']) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
    assert.ok(tag, `${id} input is rendered`);
    assert.match(tag[0], /autocomplete="off"/, `${id} carries autocomplete="off"`);
  }
});

test('raffle note warns that Tyhjennä kaikki leaves the browser autofill data', () => {
  const html = raffleHtml();
  const note = html.match(/<p class="raffle-note">([\s\S]*?)<\/p>/);
  assert.ok(note, 'raffle note is rendered');
  assert.match(note[1], /automaattis/, 'note names the browser autofill store');
  assert.match(note[1], /yksityi/, 'note points the operator to a private window');
});
