// Row-shape tolerance (idea #4618): a readable store whose rows are damaged
// must not take down Tarkastele, Vie Excel or the suggestions, and a save must
// not drop or rewrite the rows it could not use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, captureAlerts, captureDownloads, stableElements } from './dom-stub.mjs';
import { createExcelJSStub } from './palaute-fixtures.mjs';
import { PALAUTE_PATH } from './pages.mjs';

const STORAGE_KEY = 'palaute_huippu2026_v1';
const HELD_RE = /vahingoittun/i;

const GOOD = {
  id: 'good', attendance: 'both', ratings: [5, 4, 3, 2, 1, null, 5], recommend: 'kylla',
  free: { best: 'Hyvä', improve: '', topics: '', open: '' }, name: 'A', phone: '111',
};
// Kept (plain object, string id) but missing ratings and free entirely.
const BARE = { id: 'bare', attendance: 'thu', name: 'B', phone: '222' };
// Kept, with ratings and free of the wrong type and a numeric free answer.
const ODD = { id: 'odd', ratings: 'x', free: { best: 7, improve: null }, recommend: 'en' };
// Held: not a plain object, or no string id.
const HELD = [42, null, ['x'], { id: 7, name: 'Numeric id', phone: '333' }, { name: 'No id' }];

function seedRows() {
  return JSON.stringify([GOOD, BARE, ...HELD.slice(0, 2), ODD, ...HELD.slice(2)]);
}

function boot(seed = { [STORAGE_KEY]: seedRows() }, { confirmValue = true } = {}) {
  const { ExcelJS, workbooks } = createExcelJSStub();
  let alerts, downloads, elements;
  const confirms = [];
  const page = loadPage(PALAUTE_PATH, {
    seed,
    patch(s) {
      alerts = captureAlerts(s);
      downloads = captureDownloads(s);
      elements = stableElements(s);
      s.ExcelJS = ExcelJS;
      s.confirm = (msg) => { confirms.push(String(msg)); return confirmValue; };
    },
  });
  assert.equal(page.loadError, undefined, 'page boots without throwing');
  return { ...page, alerts, downloads, elements, workbooks, confirms };
}

function stored(sandbox) {
  return JSON.parse(sandbox.localStorage.getItem(STORAGE_KEY));
}

test('load keeps plain objects with a string id and holds back the rest, alerting once', () => {
  const { run, alerts, sandbox } = boot();
  assert.deepEqual(JSON.parse(run('JSON.stringify(forms.map(f => f.id))')), ['good', 'bare', 'odd']);
  assert.equal(run('storageUnreadable'), false, 'a bad row does not mark the whole blob corrupt');
  assert.equal(alerts.filter(a => HELD_RE.test(a)).length, 1, 'one alert names the held rows');
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), seedRows(), 'boot writes nothing');
});

test('Tarkastele renders kept rows that lack ratings or free', () => {
  const { run, elements } = boot();
  run('showReview()');
  const html = elements.get('review').innerHTML;
  assert.match(html, /data-edit="good"/);
  assert.match(html, /data-edit="bare"/);
  assert.match(html, /data-edit="odd"/);
  assert.doesNotMatch(html, /Numeric id|No id/, 'held rows are not rendered');
  assert.match(html, /#3/);
  assert.doesNotMatch(html, /#4/);
});

test('Vie Excel exports kept rows with defaults and leaves held rows out', async () => {
  const { run, workbooks, sandbox } = boot();
  await run('exportForms()');
  const sheets = Object.fromEntries(workbooks.at(-1).worksheets.map(ws => [ws.name, ws.rows]));
  const responses = sheets['Vastaukset'];
  assert.equal(responses.length, 4, 'header + three kept rows');
  const header = responses[0];
  const bare = responses[2];
  const odd = responses[3];
  assert.equal(bare.length, header.length, 'missing ratings still fill every rating column');
  assert.equal(odd.length, header.length, 'non-array ratings do not shift the columns');
  assert.equal(bare[header.indexOf('Nimi')], 'B');
  assert.equal(bare[header.indexOf('Puhelinnumero')], '222');
  assert.equal(odd[header.indexOf('Mikä oli päivien parasta antia?')], '7');
  assert.equal(odd[header.indexOf('Suosittelisi')], 'En');

  const summary = sheets['Yhteenveto'];
  assert.ok(summary.some(r => r[0] === 'Vastauksia yhteensä: 3'));
  const overall = summary.find(r => r[0] === 'Tapahtuman kokonaisuus');
  assert.deepEqual([...overall], ['Tapahtuman kokonaisuus', 0, 0, 0, 0, 1, 1, 5]);

  const themes = sheets['Avoimet teemat'];
  assert.ok(themes.some(r => r[0] === 'Hyvä'));
  assert.ok(themes.some(r => r[0] === '7'));
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), seedRows(), 'export writes nothing');
});

test('suggestions read kept rows without free text', () => {
  const { run } = boot();
  assert.deepEqual(JSON.parse(run('JSON.stringify(suggestionsFor("best", "").map(a => a.text))')),
    ['Hyvä', '7']);
  assert.equal(run('suggestionsFor("improve", "x").length'), 0);
});

test('a save keeps held rows unchanged after the merge, and kept rows unpadded', () => {
  const { run, sandbox, alerts } = boot();
  run('current.attendance = "fri"; saveForm()');
  const rows = stored(sandbox);
  assert.equal(rows.length, 4 + HELD.length);
  assert.deepEqual(rows.slice(0, 3), [GOOD, BARE, ODD], 'no defaults written into kept rows');
  assert.equal(rows[3].attendance, 'fri');
  assert.deepEqual(rows.slice(4), [HELD[0], HELD[1], ...HELD.slice(2)], 'held rows appended in order');

  run('current.attendance = "thu"; saveForm()');
  assert.equal(stored(sandbox).length, 5 + HELD.length, 'a second save still keeps them');
  assert.equal(alerts.filter(a => HELD_RE.test(a)).length, 1, 'still one alert');
});

test('deleting a kept row keeps the held rows', () => {
  const { run, sandbox } = boot();
  run('deleteForm("bare")');
  const rows = stored(sandbox);
  assert.deepEqual(rows.slice(0, 2), [GOOD, ODD]);
  assert.deepEqual(rows.slice(2), [HELD[0], HELD[1], ...HELD.slice(2)]);
});

test('held rows another tab wrote after load are kept too', () => {
  const { run, sandbox } = boot({ [STORAGE_KEY]: JSON.stringify([GOOD]) });
  sandbox.localStorage.setItem(STORAGE_KEY, JSON.stringify([GOOD, 'late']));
  run('current.attendance = "fri"; saveForm()');
  const rows = stored(sandbox);
  assert.equal(rows.length, 3);
  assert.equal(rows[2], 'late');
});

test('editing a row without ratings or free opens the form and is not an unsaved change', () => {
  const { run, sandbox } = boot();
  run('editForm("bare")');
  assert.equal(run('editingId'), 'bare');
  assert.equal(run('current.ratings.length'), 7);
  assert.equal(run('current.free.best'), '');
  assert.equal(run('current.name'), 'B');
  assert.equal(run('hasUnsavedEntry()'), false);
  assert.equal(sandbox.localStorage.getItem(STORAGE_KEY), seedRows(), 'opening an edit writes nothing');
  run('current.ratings[0] = 4; saveForm()');
  const saved = stored(sandbox).find(f => f && f.id === 'bare');
  assert.equal(saved.ratings[0], 4);
  assert.equal(saved.name, 'B', 'raffle fields survive the edit');
});

test('Tyhjennä kaikki names the held rows and removes them with the rest', () => {
  const { run, sandbox, confirms } = boot();
  run('clearAll()');
  assert.match(confirms.at(-1), /KAIKKI 3 lomaketta/);
  assert.match(confirms.at(-1), new RegExp(`${HELD.length} vahingoittunutta`));
  assert.deepEqual(stored(sandbox), []);
});
