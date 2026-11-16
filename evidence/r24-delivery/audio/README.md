# R24 delivery audio verification

Current task: TCL-R24-DELIVERY. This is observed test evidence, not phone, mainland-network or TCL speech-accuracy acceptance. No paid API or user recording was used.

## Fixes and regression

- Actual historical bridge (`d4d8057f74d93be897b1bb034b3e1d348c9e7562`) with three simultaneous requests reached two concurrent inferences. Current bridge keeps the maximum at one. `concurrency-before-after.json` preserves both results; audio/model fixtures are synthetic.
- Whole-session prepared PCM now uses the same selected Base/Tiny pipeline and inference lock as per-question recording, with an explicit 180-second cap. The app integration is reviewed separately.
- Timeouts never imply the native decoder/WASM worker has terminated. Raw decoder/Vosk initialization promises retain their locks until actual settlement. Bridge `isResourceBusy()` also stays true after an unhealthy timeout so callers can avoid starting Vosk over uncertain Whisper work.
- Pre-aborted decode avoids allocating AudioContext; malformed/nonfinite PCM is rejected; silence avoids model download. Forced-mirror failure no longer repeats the same mirror attempt.
- Model revisions are immutable: Base `27a07b4b52b3a4c5886134bb4320e93e1a4bbc7c`; Tiny `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`. Runtime is Transformers.js 3.8.1.
- `unit-tests.txt`: eight behavioral Node tests passed. `bridge-network.json`: two actual-bridge/intercepted-runtime cases passed (mock model; not real network fallback).

## Actual browser/model work

Linux Chromium 156.0.8078.79:

- `real-audio.json`: original 8kHz public WAV plus generated stereo 44.1kHz WAV, 48kHz AAC/M4A and 48kHz WebM/Opus decoded/downmixed/resampled to 16kHz successfully. AAC playback here does not verify Safari.
- Real pinned Base and Tiny each transcribed all three public PolyAI/minds14 zh-CN telephone-banking samples. CER was Base 13/44 = 29.55%, Tiny 23/44 = 52.27%. This remains **not accepted for business speech accuracy**. The corpus is tiny, unrelated to TCL and not a blind benchmark. `PASS` means the inference completed, not that every word was correct.
- `real-vosk.json`: actual configured Vosk JavaScript hash, 11 source chunks and merged 43,847,018-byte archive SHA were verified, then the actual worker transcribed the three public samples. Transcript errors remain visible. The report hashes the extracted current app loader/recognizer block; it is not a full UI fallback test.
- `warm-model-cache.json`: after online Tiny loading, Chromium went offline and a fresh pipeline used seven cached model/config artifacts and returned the same text. Runtime JS/WASM was already loaded in that page. This does **not** prove offline page reopening.
- `mirror-config.json`: exact pinned Base/Tiny config URLs returned HTTP 200 through this cloud network. Full mirror weight download and mainland access were not tested.

The final real Whisper/model/codec run was repeated after the `isResourceBusy()` addition and records exact final bridge hash `b93887710d61766d01396f9eb6da357c3460519877fca595b08e793d9a1b41c4`. The earlier successful report is preserved as `real-audio-before-busy-accessor.json`; it is historical evidence. The final Vosk real test was rerun after loader locking and queue-resume changes and records current loader block hash `245f04485e33bd2c5b6ad76a242eb30eaf842c15c0ed59cdcdacfbdfb3d41073`.

## Reproduce

Install Python Playwright, a Chromium executable at `/usr/bin/chromium`, Node and ffmpeg. From repo root:

```sh
node experiments/r24/tests/bridge.mjs
node --test experiments/r24/tests/bridge-delivery.mjs experiments/r24/tests/audio-locks.mjs
node experiments/r24/tests/bridge-concurrency-repro.mjs
python experiments/r24/tests/download_samples.py
python experiments/r24/tests/audio_delivery.py
python experiments/r24/tests/vosk_delivery.py
python experiments/r24/tests/audio_cache.py
python experiments/r24/tests/bridge_network.py
```

Sample WAVs download locally into `evidence/r24`; do not include them, model weights, browser profiles or caches in public release artifacts. Tests use the public corpus only; consult its source data card for licensing. Audio decoder variants are created in a temporary directory and cleaned after testing.

Still not run: actual iPhone/Android/WeChat hardware, mainland cold download, handset memory pressure, licensed TCL recordings and product-name accuracy, full offline page startup. Preserve manual correction and original recordings; do not infer model accuracy from syntax, resource or model-loading checks.
