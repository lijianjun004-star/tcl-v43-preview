# R24 independent code review

Reviewer: Codex subagent `/root/independent_review`, not Gemini.
Source baseline: PR104 `d4d8057f74d93be897b1bb034b3e1d348c9e7562`, candidate app initially copied from that revision. No model, device, or browser acceptance is claimed by these VM reproductions.

## Confirmed findings

1. **P2 — cancellation can silently drop the next run's first transcription.** `r6WhisperCancelAll()` empties the queue while `r6WhisperDrain()` awaits inference. If a new run adds a task before the old result returns, its unconditional `finally { queue.shift() }` removes the new task. Actual function-body execution records model calls `['old-q']`, empty queue, and new question left waiting. Remove the completed task by object identity. Evidence: `reproduce.cjs`, `findings.json`.
2. **P2 — explicit cleared answer resurrects wrong ASR in history/submission.** Review editor stores `manualCleared=true`, but `saveTurn` and submitted-turn snapshots omit it; `answer || transcript` displays the old text again. Preserve the flag in durable/submitted records, honor it in ordinary text views, keep raw ASR available separately. Evidence: same reproduction.
3. **P2 — stale assignment save renders operator UI for another identity.** `publishAssignment()` awaits IndexedDB and always calls `operatorHome()`. Switching to an anchor while the transaction is pending renders an operator workbench under the anchor identity. `joinAssignment()` similarly navigates after an identity/view change. Proposed replacement captures owner and DOM view token, serializes submission, handles write failures without phantom success, and revalidates identity/view before UI actions. Evidence: `assignment-race.cjs/json`; patch `assignment-fix.patch`; eight regression cases `experiments/r24/tests/assignment-regression.cjs`.

The assignment replacement functions passed all 8 VM regression cases before integration. Final app integration must be re-run and reviewed.

## Additional independently confirmed browser findings

The browser QA agent confirmed main knowledge-import stale scope/platform preview, duplicate rows on double save, and a null-element exception after delayed parse returns to a departed view. Evidence held by that agent: `evidence/r24-delivery/ui/knowledge-import-before.json`. App owner/root notified. This review did not duplicate the other agents' parser, bridge, or persistence implementation.

## Remaining acceptance limits

Local role/name filtering is explicitly not authentication or cross-device sync. Existing code and reports disclose this. Browser/VM synthetic audio tests cannot prove real iPhone capture, mainland network reachability, or TCL business speech accuracy. The input package's tiny bank-speech sample retains high CER; no approval of business speech accuracy follows from this audit.

## Final integrated delta review

Final reviewed app SHA-256: `b086a0c5c9610f338d9c5ac86db631b191758c7bc4e7f50228777d6dd5144deb`.

- Original three findings are corrected in integrated app. `assignment-regression.cjs`: **8 PASS** on actual integrated function bodies.
- Found and fixed additional late-settlement wake gap: a Vosk timeout wrapper could finish while its real inference still held the resource, then raw settlement woke only Vosk, leaving pending Whisper stalled. `app-queue-wakeup.mjs`: **2 PASS**, resolve/reject variants, no overlapping inference or late old-result writes.
- Found and fixed persisted-page-history handler defect: pagehide reset run state but pageshow left stale review controls whose saves silently did nothing. `history_recovery.py`: **2 checks PASS**, actual Chromium UI and IndexedDB with **synthetic persisted page-transition events**, not native BFCache/mobile proof. Stale review routes to home; explicit saved-session restoration permits successful edits. `evidence/r24-delivery/history/result.json` records unchanged source SHA and zero page errors.
- Reviewed checkpoint transaction ordering, media/name scoping, import batch atomicity, raw-job locking and poisoned-Whisper fallback messaging. No additional P1/P2 defect found in that examined delta. Timeouts that poison Whisper deliberately require backup/reopen; the UI states this instead of claiming fallback started.

This is an independent Codex review, not Gemini verification. It is bounded to inspected code and executed tests; real phones, mainland connectivity and business speech accuracy retain their separately stated acceptance limits.
