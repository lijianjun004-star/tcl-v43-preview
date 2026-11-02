# V4.3 R6.1 isolated frontend preview

Temporary functional prototype at https://lijianjun004-star.github.io/tcl-v43-preview/ . Only static files from `site.zip` are published. No production authentication, operations backend, payments, or cloud AI grading. Use fictitious nicknames and test questions only.

R6.1 attempts Chinese speech recognition through the browser's SpeechRecognition / webkitSpeechRecognition API after explicit opt-in. The browser vendor may process audio online. API presence does not establish real mobile compatibility. No Paraformer model download, sherpa inference runtime, or Gemini audio fallback is deployed. Only final speech results are saved; incomplete/interrupted recognition remains pending without a fabricated score. Speech text is hidden during recording.

This merges onto main `12e75bee89330ca4bb1844ced6b970db1b83d557` (R5.1), preserving database `tcl-v43-preview-r4` version 2 with its exact storage implementation, recorder lock, relative gateway paths, R5.1 failed-start diagnostics and local-only identities. The service worker uses `tcl-v43-preview-shell-v4.3.14-pages-r6.1`; activation removes only outdated caches starting `tcl-v43-preview-shell-`. Existing model caches and IndexedDB data are preserved. No site-data clearing is required.

Validation before merge: build 43 files; R6 race tests 14 passed; full suite 65 passed / 1 skipped / 0 failed; HTTP resource smoke passed. These include synthetic recognition events and do not establish human ASR accuracy. A further network-error regression was reproduced and fixed so later final fragments cannot reset an incomplete answer to OK. Original failure log is preserved in the separate delivery evidence.

Physical iPhone Safari, Huawei/Honor, Xiaomi/OPPO/vivo browser recording + microphone + speech recognition for 3–5 minutes: **NOT_TESTED**. No physical phones are attached to the development environment. Formal scoring/backend integration remains unavailable.

The existing push-to-main Pages workflow is retained with the newly audited archive SHA-256. Deployment is restricted to this repository. `live-practice-room`, CloudBase and the operations backend are not deployment targets. No paid service or API is provisioned.

Rollback: revert the R6.1 merge through a PR, restoring the R5.1 `site.zip` and its matching workflow checksum (`babf55b96b41bed061ff4f3bb93667cb2beaf4f99bc43d099ffedfc3722dbf93`). Keep IndexedDB and model caches. The previous release remains in Git history.
