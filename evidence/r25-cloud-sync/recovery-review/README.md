# Narrow checkpoint review: actual functions + real Chromium IndexedDB

Input app SHA256: `684a244a1f62e15d9dbfddc88e8f314eedb416fecfb4ca3419115e60c6d57e16` (identical before and after).

`recovery_probe.py` extracts the app's actual dbOpen/dbAll, persistSessionCheckpoint, findSavedSession, and cloud partition readiness/switch functions unchanged into a small local browser fixture. It uses synthetic A/B/C identities and real IndexedDB stores, with minimal UI/current-session/record-shape stubs. No CloudBase SDK, account, model, network API or product file is used/modified.

14 checks PASS, Chromium 156.0.8078.79, no page errors:

- Automatic A partition initialization installs its actual saved candidate and observed token.
- Same-partition fast path initializes a deliberately missing cursor.
- First checkpoint after automatic restore successfully commits to actual IDB.
- A known same-partition switch retains the same cursor object/token and performs no read. After an external writer changes the DB token, same-partition prepare does not adopt it; the next checkpoint is rejected by CAS with zero puts and preserves the external row.
- A actual IDB read's success delivery is held, partition switches to B, then A's callback is released. B global cursor/key/token and candidate remain B.
- C read request's actual IDB transaction is aborted. Cursor remains unknown/null; save refuses, performs no puts, and preserves the original C row/token.

The delay fault defers the application's native request success handler; it does not mock the returned IDB data. The failure fault aborts a real IDB transaction. Result details are in `result.json`; all observations are scoped to these extracted functions and synthetic local fixtures, not full app UI, real native authentication, cloud persistence, or physical phones. Parent root independently validates the public app and actual auto-restored auth flow.
