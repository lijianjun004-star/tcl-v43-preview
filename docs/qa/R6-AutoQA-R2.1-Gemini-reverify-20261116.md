# R6 AutoQA R2.1 — Gemini re-verification and timeout-race blocker

Status: **QA CANDIDATE ONLY; NOT APPROVED FOR MERGE OR DEPLOYMENT**.

Date: 2026-11-16. Base `main` commit: `325d4d0065cb11ab696b87765170df8016d3896a`.

## Evidence from this review
- Gemini upload: `TCL-R6-AutoQA-优化源码与复验证据包-20261116.zip` (reviewed as user-supplied input).
- Manifest: 42/42 SHA-256 matches, source R2 page: 13 files and 12 asset hashes valid.
- Independently executed Gemini Python build tests: 7/7 PASS.
- Independently executed Node Whisper module mock tests: 5/5 PASS.
- P0 reproduction: Gemini R2's promise timeout is not cancellation. Two sequential 60ms-timeout model calls caused **two overlapping underlying inferences** (max active = 2).
- Local R2.1 hardening prototype: fail-closed on inference/load timeout, stop Whisper reentry and rely on available Vosk/manual recovery; 4/4 timeout regression tests PASS and previous 5/5 Whisper tests PASS.
- Chromium local E2E: **NOT RUN** (local URL navigation blocked: `ERR_BLOCKED_BY_ADMINISTRATOR`).
- Real iPhone Safari / Android speech recognition: **NOT RUN**.
- Real Chinese transcription with downloaded weights: **NOT RUN**.
- Independent R2.1 package checksum SHA-256: `ba9a1b0e092c1fc966d45db93c6f8e2265efcd070b9bd442b82db7a9b0a5fc3e`.
  The ZIP was generated in the user chat as `TCL_R6_AutoQA_R2_1_Hardened_Codex_QA_20261116.zip` and must be supplied to Codex; it is **not** present in this GitHub repository.

## Nonnegotiable safety boundaries
- Keep original `site.zip` SHA-256 `099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e` unchanged.
- Keep original R6 `tcl-v352-asr/app.js` SHA-256 `37cae0f8674e108041eeab317ca5632fa32456cd4bcdbccf2fc142f40bc1a298` unchanged.
- Preserve `/tcl-v352-asr/`, `/tcl-v352-asr-autoqa/` and all existing routes; test R2.1 only at a new `/tcl-v352-asr-autoqa-r2/` prefix.
- Do not assume Vosk fallback works if the Vosk model is not already loaded.
- Do not label simulated Whisper text as actual recognition accuracy.
- Require independent browser, model-download, memory, multi-question, early-exit and physical iPhone testing before promotion.

## Codex handoff
1. Retrieve the attached R2.1 ZIP from the user and verify full SHA-256 and package manifest.
2. Compare its Gemini R2 source against current main and audit the hardened model adapter.
3. In an independent code PR, add a new, isolated R2 path. If trusted CI gating must change, update it in a **separate** gate PR first.
4. Run all tests, include real results, and request user authorization before any PR merge or Pages deployment.

**This branch contains QA evidence only; it does not contain the deployable R2.1 source.**
