# Storage

Browser localStorage is the only data store. A blob that fails to parse is
damaged, not absent — writing over it destroys the last chance of recovery.
Both apps mark such a key unreadable, tell the user once, and divert later
writes to `<key>_recovery`, which is read back in the canonical key's place
so ids and counters stay stable across reloads. A recovery value that fails
to parse is left in place too: palaute keeps new rows in memory and tells the
operator to export; yatzy does not write fresh seat ids over it. A palaute
deleted-list that fails to parse diverts to its own `_recovery` sibling
(`…_deleted_recovery`).

| App | Keys | Invariants |
| --- | --- | --- |
| palaute.html | `palaute_huippu2026_v1` + siblings `_recovery`, `_deleted`, `_recovery_deleted`, and `_deleted_recovery` when that list fails to parse | Never overwrite a blob that failed to parse (`load` sets `storageUnreadable`; `persist` writes `STORAGE_RECOVERY_KEY`). A `_deleted` list that fails to parse is not overwritten; new deletes go to `…_deleted_recovery`. If the forms recovery blob itself fails to parse, new rows stay in memory. `persist` re-reads the writable key and merges by id; ids in the matching deleted-list stay deleted, so another tab's save cannot drop or resurrect a response. `clearAll` records this tab's ids as deleted and merges. A corrupt canonical blob is deleted on that explicit wipe; recovery rows this tab never had are written to the canonical key, then the recovery pair is removed and `storageUnreadable` clears. `saveForm` refuses a fully blank form. |
| yatzy.html | `yatzy_players`, `yatzy_statistics`, and legacy `yatzy_playerNames` (read only when no seats exist, but still written in sync on every seat save); each has a `_recovery` sibling | Never clear seats or statistics on load — a stats reset is `confirmResetStats()`. Unreadable blobs use `readStore` / `writeStore` over `unreadableStores`. A `<key>_recovery` value that fails to parse is left in place (`unreadableRecovery`); `initSeats` does not replace it with fresh seat ids. |

A "reset" action must clear the recovery copy alongside the canonical key, or
the diverted data is simply read back afterwards. palaute's readable `clearAll`
does not delete the canonical key first: it records the ids this tab had and
merges, so a row only another tab has written is kept. Do not "simplify" a
diverted write back into a direct `setItem`.

A write the browser refuses (storage blocked, quota full, `localStorage` null)
must not throw out of its caller: palaute's `persist()` and yatzy's
`writeStore` / `clearStore` catch it, alert, and the page keeps working in
memory. yatzy's `endGame` shows the game-over overlay before writing stats.
