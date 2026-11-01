# V4.3 R5.1 isolated frontend preview

Temporary functional prototype. Only audited static frontend files are published. No production authentication, operations backend, payments, or cloud AI scoring. Do not enter real personal information.

ASR is unavailable: Paraformer weights are intentionally absent pending redistribution review. Camera, local question sets and recording require voluntary device testing.

New site only; live-practice-room and CloudBase are not deployment targets. Browser database, shell cache and model cache use preview-specific names.

The workflow verifies the static archive SHA-256, extracts it, and deploys only _site. No server, .env, API keys, private recordings, or internal logs are in the archive. Runtime Apache-2.0 license and notice are included.

R5 fixes historical result visibility, failed recording recovery guards and an always-available exit. Original preview database/model-cache names and privacy notice are preserved. No model weights or backend scoring were added.

R5.1 also displays the saved device error in read-only failed-start diagnostics.
