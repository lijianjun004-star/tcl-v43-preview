# Record cache regression

Result: **10/10 PASS**, native Chromium `156.0.8078.79` and native IndexedDB, app SHA-256 `8dfa75983e44ce04d6e3620a2080fef51354a71a89c56c4ef935f281605dc332` unchanged throughout the run. No page errors or model calls.

Command from the source worktree:

```sh
R24_RECORD_CACHE_OUT="$PWD/evidence/r24-performance-v2/record-cache" python experiments/r24/tests/record-cache.py
```

The script uses a synthetic 25-turn checkpoint and the real page UI. Browser-side instrumentation counts native `IDBObjectStore.put` calls and transaction completion/abort events; it does not add application test hooks. The 40-character burst dispatches synthetic DOM input events and awaits the final saved state, so it establishes one checkpoint per event and verifies the complete stored text. It does **not** establish physical keyboard performance or refresh durability; separate reload probes cover refresh behavior.

- First save after restore writes all 25 records; a subsequent single-turn edit writes one.
- A 40-input post-transcript burst completes 40 transactions and 40 checkpoints, with zero unchanged record writes.
- A synthetic quota exception at the checkpoint write aborts both checkpoint and changed record. The next successful edit to another turn writes both changed rows, showing the failed transaction did not advance the cache.
- Two saves queued in one browser task write one changed row each after predecessor completion.
- A fresh tab starts with an empty cache and writes all 25 records on its first save.
- A stale tab whose turn records are unchanged still performs the checkpoint CAS check and aborts before overwriting the winning tab.
- Starting a new run in the same page writes the new turn and does not write old-run record IDs.

The last check covers a normal completed-save reset/new-run transition. It does not force an old transaction to complete after reset; the source captures a replaceable map for that isolation, and broader session/concurrency tests are reported separately. There were no failed runs or script corrections for this execution.
