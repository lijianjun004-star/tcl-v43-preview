# R24 mobile responsiveness and native-scale inputs

Task TCL-R24-SMOOTH-MOBILE-20261116. User reports lag and unwanted page scaling while practising, switching questions and recording. ChatGPT/Codex implements and independently reviews; no Gemini calls, paid API, backend, private operating table or automatic jobs.

Baseline: main 3e4198afa9c7aecbbbff4c8bbc9d01b3efd8e15c, source fix/r24-delivery-20261116 at 3672708. Frozen manifest r24-smooth-mobile-20261116. Exact asset pins and ZIP/base64 hashes: evidence/r24-smooth-mobile/release/freeze.json.

## Repairs

- Do not rebuild the hidden full question-summary table while practising or viewing the review overview/replay. Build the complete table on entering review details. Current question status still updates immediately; full references, model/SKU/source, manual edits and recordings remain available.
- On mobile/coarse-pointer screens, every input/select/textarea uses 16px, overriding older 14px/15px specific selectors that trigger iOS focus zoom. Focus the text-answer sheet without page scrolling. Keep the device-width viewport and existing touch-action:manipulation controls; deliberate browser accessibility zoom is not disabled.
- Remove live overlay backdrop blurs and animated spreading recording shadows to reduce repeated video compositing.
- Run Transformers model loading and WASM inference in a dedicated module Worker. WebAudio stays on the page. Preserve pinned Base/Tiny models, q8 and Mandarin options, original audio and prepared PCM, serial inference, timeouts/unhealthy locks, progress and mirror policy. Worker failure is explicit; never silently run model computation back on the UI thread.

Only app.js/style.css/whisper-bridge.mjs/manifest changed; whisper-worker.mjs added. No library parser, storage format, limits, seed question facts or previously deployed sites changed.

## Actual verification

- Before/after stress: real Chromium touch/mobile emulation at 320×568, 390×844, 430×932 with 4× CPU throttle; synthetic 60 questions/80 progress updates. Baseline performed 80 hidden full table rebuilds taking 1592/1585/2721ms; fixed performed zero, 0–0.2ms for that callback workload. This measures removed work, not a real phone's frame rate. Review still shows all 60 rows. Both live/review inputs compute to 16px, viewport scale1, no horizontal overflow. See before/result.json and browser/result.json.
- Browser three-question recording uses real MediaRecorder with synthetic mic/video and mock model inside the actual module Worker: all three transcriptions linked correctly, manual second answer preserved, records persisted, no page errors. See recording/result.json.
- Recovery 10, cross-tab consistency 10, previous question-bank 31 and legacy compatibility 8 checks passed. Includes exact media hash recovery, manual clearing, quota abort and stale-tab submission rejection. No private data used.
- Worker browser tests: mirror fallback/forced mirror/failure, no Worker and script failure; two synchronous 250ms computation loops run in the Worker while the page heartbeat continues, inference maximum concurrency1. Proxy tests plus existing bridge concurrency/timeout/PCM checks and 14 app regressions passed.
- Actual pinned Tiny runtime and inference ran in the real Worker on synthetic 1-second 440Hz PCM (9.619s including runtime/model load; page20ms heartbeat473 times). The output “好” on a tone demonstrates hallucination risk, not accuracy. Real Base inference in a Worker and physical mobile devices not exercised. See worker/bridge-worker-real-tiny.json.
- CI exact four-version gate and full old→new→old builds: evidence/r24-smooth-mobile/release/policy-real.json. 195 protected older assets unchanged; new total217 / rollback216 resources.

## Test harness failures retained

The original recovery harness intercepted whisper-bridge.mjs and accessed window inside its model mock. After moving the model to a Worker, it failed to supply mock transcripts; it is not valid evidence for the new Worker. The adapted browser_smooth_e2e/session_smooth_recovery intercept the Worker and explicitly forward serializable test traces. The first adapted trace attempted to clone a callback in mock pipeline options, producing DataCloneError; copying only device/dtype/revision fixed the test fixture, with no product change. Old recovery failure is retained in failures/old-mock-recovery.json. An initial exploratory before run crossed source edits and was discarded; the authoritative before run uses an immutable extracted production archive.

## Delivery boundaries

This fixes the identified rendering/focus/runtime problems. Physical iPhone/Android/embedded browsers, keyboard/autofocus zoom behaviour on actual iOS, domestic network conditions, thermal/memory pressure and TCL speech accuracy still need real-device feedback. Model downloads still cost time; moving work to a Worker does not make a large model smaller or guarantee smoothness on every device. No external Gemini/Argon acceptance is claimed.

Publish only the frozen archive after the separate exact CI policy PR passes. Rollback by a new PR restoring the prior question-bank archive; do not clear IndexedDB/browser records. Deployment evidence is recorded in main AI_CONTEXT.md after actual success.
