# Singlepagers

> Collection of standalone single-page web applications.

## Apps

- `yatzy.html` — 2-player Finnish Yatzy scorecard with persistent per-seat statistics. Live at https://mase.fi/yatzy.html
- `palaute.html` — operator-driven Finnish event-feedback entry for *Työhyvinvoinnin huipulla 2026* (attendance, ratings, recommend, four free-text fields with a fuzzy-bigram suggestion engine, review/edit, Excel/JSON export). Live at https://mase.fi/palaute.html

## Key Patterns

- Each app is a single self-contained HTML file
- No build process or external dependencies (ExcelJS in palaute.html is the one optional exception)
- All logic, styles, and markup in one file per app
- UI is rendered via `innerHTML` template literals — every user-controlled value must go through that file's `escapeHtml()` helper
- palaute.html's CSP allows `script-src 'self' 'unsafe-inline'` plus cdnjs (it needs ExcelJS); yatzy.html's allows `'self' 'unsafe-inline'` only. Both are `<meta http-equiv="Content-Security-Policy">` tags near the top of each file.

## Deploy

Push to `origin` (`forgejo@localhost:mase/singlepagers.git`) fires Forgejo's
post-receive hook → `forgejo-deploy singlepagers <branch>`. The usual path is
`deploy`, which lands the worktree on `master` and pushes. The hook checks the
pushed ref out to a temp dir and copies **top-level** `*.html` into
`/var/www/html/` (`cp "$TMPDIR"/*.html`). `test/` is not copied, so
`test/smoke.html` is not published. Confirm a deploy by fetching the two live
URLs above; `https://mase.fi/test/smoke.html` must 404.

## Storage

Browser localStorage is the only data store. A blob that fails to parse is
damaged, not absent — writing over it destroys the last chance of recovery.
Both apps mark such a key unreadable, tell the user once, and divert later
writes to `<key>_recovery`, which is read back in the canonical key's place
so ids and counters stay stable across reloads.

| App | Keys | Invariants |
| --- | --- | --- |
| palaute.html | `palaute_huippu2026_v1` + sibling `_recovery` | Never overwrite a blob that failed to parse (`load` sets `storageUnreadable`; `persist` writes `STORAGE_RECOVERY_KEY`). `clearAll` is the reset: it wipes both keys and clears `storageUnreadable` so later persist returns to the canonical key. |
| yatzy.html | `yatzy_players`, `yatzy_statistics` (legacy `yatzy_playerNames` migrated once); each has a `_recovery` sibling | Never clear seats or statistics on load — a stats reset is `confirmResetStats()`. Unreadable blobs use `readStore` / `writeStore` over `unreadableStores`. |

A "reset" action must clear the recovery copy alongside the canonical key, or
the diverted data is simply read back afterwards. Do not "simplify" a diverted
write back into a direct `setItem`.

A write the browser refuses (storage blocked, quota full, `localStorage` null)
must not throw out of its caller: palaute's `persist()` and yatzy's
`writeStore` / `clearStore` catch it, alert, and the page keeps working in
memory. yatzy's `endGame` shows the game-over overlay before writing stats.

## Data handling (`palaute.html`)

Optional raffle name and phone live in each saved form (`blankForm`), persist
unencrypted in localStorage (typically a shared venue device), and are written
into both the `.xlsx` and the JSON fallback export. The page promises they stay
in this browser for the raffle — nothing may transmit form data off-device (no
upload, no sync). After the event: export, then Tarkastele → Tyhjennä kaikki
(`clearAll`).

## ExcelJS (`palaute.html`)

One optional CDN dependency: ExcelJS 4.4.0, SRI-pinned, loaded inside
`exportExcel()` (not at page load). Offline / CDN down / 8s hang falls back to
JSON via `exportJsonFallback()`. Version bumps, SRI regeneration, and CVE
monitoring: [`docs/exceljs.md`](docs/exceljs.md).

## Tests

No-deps `node:test` suite under `test/` (run `node --test test/*.test.mjs`).
`loadPage` in `test/dom-stub.mjs` extracts each page's inline `<script>` and
runs it under `node:vm` against a fake DOM — zero changes to the HTML under
test. Excel export tests share `createExcelJSStub`.

Page-script coverage is not `node --test --experimental-test-coverage` — that
reporter prints 100% over zero files because the vm filenames
(`yatzy.html#script`, `palaute.html#script`) are not file URLs. Use raw V8
coverage instead; start from an empty `.coverage/` (leftover files merge and
can hide a drop):

    NODE_V8_COVERAGE=.coverage node --test test/*.test.mjs && node test/coverage.mjs

Floors live in `test/coverage.mjs` (palaute 88%, yatzy 92% function entry —
the current rate, a ratchet, not a target). `.coverage/` is gitignored. Do
not add a GitHub Actions workflow — this repo has no GH runner; the session
that pushes runs the gate.

`test/smoke.html` is a manual browser check for the yatzy load-persistence
invariant (legacy names stay byte-identical; name-keyed stats migrate under
seat ids with counters intact). Serve the repo root over HTTP from the same
origin as `yatzy.html` and open it; it is not part of the `node --test` run.
