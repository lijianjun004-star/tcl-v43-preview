# Actual local UI + real name/invitation service

**PASS 26/26, first run, exit 0.** All browser contexts closed after completion. Actual product UI served at localhost:8766, actual deployed HTTPS name broker, official native Auth and real PostgreSQL business API. No config, SDK, or business reply was injected or mocked.

Five actual HTTP 200 `app.js` responses match SHA256 `7c83ce664b2290be4d0d5326ef63ff7e3ca41f23436d3665e8f63a9ccf49ff1e`. System Chromium `156.0.8078.79`. Product page errors 0; instrumented model-download requests 0. Five mobile screenshots are included.

Three independent synthetic Chinese names were enrolled through the actual operator/anchor/other-user forms. A fourth isolated context performed ordinary name/password login. Actual model preference UI reload retained native login and first text save succeeded. The new operator published a task; the new anchor joined, saved a text answer, submitted to the locked actual operator UID, obtained a real receipt, received the operator's feedback and read it after reload. The other user's context saw neither the unjoined task nor the submitted record.

The anchor enrollment's successful ready response was intercepted at real Chromium CDP response stage and dropped. The page stayed outside the authenticated workspace. Resubmitting the actual form used the original operation ID/secret and status endpoint to recover the same native UID: **register requests 1, status requests 1**. No callback error. This verifies loss of a successful ready response; it does not claim to test a server crash between native creation and SQL finalize.

All three enrollment contexts stored neither password nor invite code in localStorage/sessionStorage or their registration IndexedDB rows. Returned evidence contains only safety booleans and counts, not storage contents or operation secrets.

Not executed in this UI suite: public GitHub Pages deployment/origin; physical devices; mainland network; ASR accuracy/model download; provider account-list completeness audit; formal whole-database snapshot comparison; controlled native-create/finalize server crash. Those boundaries remain separate from these 26 checks. A provider list filtered by a username prefix was not used as evidence that an account is absent.

Detailed checks and HTTP hashes: `result.json`. Exact invocation/exit: `command.json`. Output: `run.log`. Source snapshot: `SOURCE-INPUTS.json`. Private fixtures are excluded; exact broker/UI passwords/invites and JWT-pattern scan passed in `SECRET-SCAN.json`. No further cloud request was made after completion.
