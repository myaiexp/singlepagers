# Singlepagers

> Collection of standalone single-page game applications.

## Key Patterns

- Each game is a single self-contained HTML file
- No build process or external dependencies
- All logic, styles, and markup in one file per game
- Deployed to VPS via git push — HTML files copied directly to web root
- Live at: `mase.fi/yatzy.html`
- `porssi.html` was removed — superseded by the standalone spot-price project

### Documented exception: ExcelJS in `palaute.html`

`palaute.html` is the one file with an external dependency. It loads ExcelJS 4.4.0
from cdnjs **on demand** (inside `exportExcel()`, not at page load) to generate the
`.xlsx` export, pinned by a Subresource Integrity (SRI) hash so a tampered CDN
payload is rejected. The page itself boots and does all data entry with **no**
network dependency — only the Excel export needs to reach the CDN, and it degrades
to an alert if the load fails. When bumping the ExcelJS version, regenerate the SRI
hash (`curl -s <url> | openssl dgst -sha512 -binary | openssl base64 -A`, or take it
from the cdnjs package page) and update `EXCELJS_URL` + `EXCELJS_SRI` together.

### Tests

No-deps `node:test` suite under `test/` (run `node --test test/*.test.mjs`). Each
test extracts a page's inline `<script>` and runs it under `node:vm` against the
`dom-stub.mjs` fake DOM — zero changes to the HTML under test.
