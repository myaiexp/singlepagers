# Testing

No-deps `node:test` suite under `test/`. Run it with:

    node --test test/*.test.mjs

## Harness (`test/dom-stub.mjs`)

`loadPage(path, { seed, patch })` extracts the page's first attribute-free
`<script>` and runs it under `node:vm` against a fake DOM. The HTML under test
is not changed. `patch(sandbox)` runs before the page script. `run(src)`
evaluates in the same realm, so top-level `let`s (`current`, `cursor`,
`forms`) and page functions are reachable. A load-time exception comes back
as `loadError`.

- **Default DOM**: every `getElementById` / `querySelector` returns a new
  forgiving element, and `classList.contains` is always false. Most tests are
  written against that.
- **Patches** (call from `patch`; each returns the record it keeps):
  - `stableElements(sandbox, { method, recordClasses, descendants })` returns
    one element per id (or per key of `method`, e.g. `querySelector`).
    `recordClasses` gives it a Set-backed classList (`recordingClassList`).
    `descendants: true` also keeps the element's `querySelector` /
    `querySelectorAll` results per selector until its `innerHTML` is
    reassigned, as a real re-render replaces descendants and their listeners,
    and records classList throughout. Use it to fire what the page bound
    (`onclick`, `addEventListener`) or to observe the entry/review `hidden`
    toggle.
  - `captureAlerts(sandbox)` records `alert()` messages;
    `captureCreated(sandbox, onCreate)` records `document.createElement`.
- **Events** (`test/dom-events.mjs`, re-exported by `dom-stub.mjs`):
  `addEventListener` on elements and the document records.
  `dispatch(target, type, init)` calls the listeners in order with one event
  (`key`, `ctrlKey`, `metaKey`, `preventDefault`, ...) and returns it;
  `listeners(target, type)` lists them. There is no bubbling, and
  `document.activeElement` is whatever the test assigns.
- `setTimeout` is a no-op, so assign `sandbox.setTimeout` when a callback must
  run. `confirm()` returns false; assign `sandbox.confirm` to accept.
- `createExcelJSStub()` is shared by the Excel-export tests.

Paths come from `test/pages.mjs` (`YATZY_PATH`, `PALAUTE_PATH`, `REPO_ROOT`).
`test/yatzy-fixtures.mjs` has `scorecardTotalling(run, upper, lower)`, built
from the page's own `scoreCategories`: fixtures read the data model from the
loaded page (`scoreCategories`, `FREETEXT`) rather than restating ids.

`test/palaute-keyboard.test.mjs` is the reference for event-wiring tests.

## Coverage gate

Page-script coverage cannot come from `node --test
--experimental-test-coverage`. That reporter prints 100% over zero files
because the vm filenames (`yatzy.html#script`, `palaute.html#script`) are not
file URLs. Use raw V8 coverage instead, starting from an empty `.coverage/`
(it is gitignored). Leftover files from an earlier run merge in and can hide a
drop.

    NODE_V8_COVERAGE=.coverage node --test test/*.test.mjs && node test/coverage.mjs

`test/coverage.mjs` fails below the per-page function-entry floors in
`FLOORS`. The floors are the current measured rate rounded down: a ratchet,
not a target. Raise them when coverage rises, and update the pinned values in
`test/coverage.test.mjs` with them.

Do not add a GitHub Actions workflow. This repo has no GH runner, so the
session that pushes runs the gate.

## Manual check: `test/smoke.html`

A browser check for the yatzy load-persistence invariant: legacy names stay
byte-identical, and name-keyed stats migrate under seat ids with their
counters intact. Serve the repo root over HTTP from the same origin as
`yatzy.html` and open `test/smoke.html`. It is not part of the `node --test`
run, and the deploy hook does not publish it (only top-level `*.html` is
copied).
