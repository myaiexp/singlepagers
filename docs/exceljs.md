# ExcelJS in palaute.html

`palaute.html` is the one file with an optional external dependency. It loads
ExcelJS 4.4.0 from cdnjs **on demand** (inside `exportExcel()`, not at page load)
to generate the preferred `.xlsx` export, pinned by a Subresource Integrity (SRI)
hash so a tampered CDN payload is rejected. The page itself boots and does all
data entry with **no** network dependency.

Constants live next to the loader in `palaute.html`: `EXCELJS_URL`, `EXCELJS_SRI`,
`EXCELJS_LOAD_TIMEOUT_MS` (8000). `loadExcelJS()` injects a `<script>` with those
values; `fail()` (timeout or `onerror`) drops the cached promise so a later retry
injects a fresh tag.

## Offline fallback

If ExcelJS cannot load (offline venue, CDN down, or the request hangs past 8s),
export **falls back to JSON** via `exportJsonFallback()` — same three sheets
(Vastaukset / Yhteenveto / Avoimet teemat) plus raw `forms` from
`buildExportPayload()`, no library required. The operator still gets a complete
download; they are told the format was JSON rather than Excel.

## Version bump

When bumping ExcelJS, regenerate the SRI hash and update `EXCELJS_URL` +
`EXCELJS_SRI` together:

```
curl -s <url> | openssl dgst -sha512 -binary | openssl base64 -A
```

(or take the hash from the cdnjs package page). palaute.html's CSP already
whitelists `https://cdnjs.cloudflare.com` in `script-src`; yatzy.html's does not
— do not add a CDN script there without changing its policy.

## CVE monitoring

There is **no `package.json`** by design, so there is no `npm audit` /
Dependabot coverage for this single CDN dependency. Check it manually before
any event that produces an export: `npm view exceljs version` flags a newer
release, and the [ExcelJS advisories](https://github.com/exceljs/exceljs/security)
list known CVEs. SRI pinning already blocks a tampered CDN payload; this
manual step covers vulnerabilities in the pinned version itself. (4.4.0 was
the latest as of the last review.)
