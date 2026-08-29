# Singlepagers

> Collection of standalone single-page web applications.

## Key Patterns

- Each app is a single self-contained HTML file
- No build process or external dependencies
- All logic, styles, and markup in one file per app
- Deployed to VPS via git push — HTML files copied directly to web root
- Live at: `https://mase.fi/yatzy.html`

### Documented exception: ExcelJS in `palaute.html`

`palaute.html` is the one file with an optional external dependency. It loads
ExcelJS 4.4.0 from cdnjs **on demand** (inside `exportExcel()`, not at page load)
to generate the preferred `.xlsx` export, pinned by a Subresource Integrity (SRI)
hash so a tampered CDN payload is rejected. The page itself boots and does all
data entry with **no** network dependency.

If ExcelJS cannot load (offline venue, CDN down, or the request hangs past 8s),
export **falls back to JSON** via `exportJsonFallback()` — same three sheets
(Vastaukset / Yhteenveto / Avoimet teemat) plus raw `forms`, no library required.
The operator still gets a complete download; they are told the format was JSON
rather than Excel. A stalled script load is treated the same as `onerror`: the
cached promise is dropped so a later retry injects a fresh `<script>`.

When bumping the ExcelJS version, regenerate the SRI hash
(`curl -s <url> | openssl dgst -sha512 -binary | openssl base64 -A`, or take it
from the cdnjs package page) and update `EXCELJS_URL` + `EXCELJS_SRI` together.

There is **no `package.json`** by design (see "No build process" above), so there is
no `npm audit` / Dependabot coverage for this single CDN dependency. Check it manually
before any event that produces an export: `npm view exceljs version` flags a newer
release, and the [ExcelJS advisories](https://github.com/exceljs/exceljs/security)
list known CVEs. SRI pinning already blocks a tampered CDN payload; this manual step
covers vulnerabilities in the pinned version itself. (4.4.0 was the latest as of the
last review.) A page-level `Content-Security-Policy` further limits script origins to
self + cdnjs — see the `<meta http-equiv="Content-Security-Policy">` tag in each file.

### Tests

No-deps `node:test` suite under `test/` (run `node --test test/*.test.mjs`). Each
test extracts a page's inline `<script>` and runs it under `node:vm` against the
`dom-stub.mjs` fake DOM — zero changes to the HTML under test.
