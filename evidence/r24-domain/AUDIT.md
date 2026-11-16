# R24 ASR independent audit

Read-only audit of existing R24 candidate. No shared app edits. Actual Chromium + REAL Whisper Base q8 used for the API probe. Sources downloaded from npm package `@huggingface/transformers@3.8.1`; source directory remains scratch only.

## Findings

1. `prompt_ids` is documented but not wired into Whisper generation in 3.8.1. `src/models/whisper/generation_whisper.js:58` declares the property. `src/models.js:3471` has it commented in the function signature; `models.js:3479` initializes tokens only from `kwargs.decoder_input_ids` or `_retrieve_init_tokens`. No operational prompt_ids reference exists elsewhere in `src`. Actual baseline and prompt_ids output were byte-identical in the tested sample.
2. `decoder_input_ids` does condition the actual model. Whisper prefix verified from model/tokenizer metadata: `[50361, ...tokenizer.encode(' '+glossary,{add_special_tokens:false}), 50258,50260,50359,50363]`, corresponding to startofprev, glossary tokens, startoftranscript, zh, transcribe, notimestamps. Do not hardcode these IDs in generic code; read exact model metadata/tokenizer.
3. Pipeline echoes glossary text unless the prefix tokens are removed before ASR decoding. `src/pipelines.js:1884` passes the generate result to `_decode_asr`; `src/tokenizers.js:3627` starts its implementation, which skips special tokens but retains ordinary prompt text tokens. Actual raw output included the entire supplied glossary. A temporary `_decode_asr` wrapper requiring exact prefix-token match and slicing it before calling the original removes the echo. This private API requires a pinned version, shape validation, a serial lock, finally restoration and fail-closed behavior. **Not recommended to ship now** because tested recognition deteriorated despite correct prefix stripping.
4. Public baseline audio is 8 kHz mono G.711 μ-law telephone audio (ffprobe), not TCL speech captured on a modern phone mic. High CER cannot be attributed to missing TCL glossary from this test set. Small non-domain samples cannot estimate business-domain accuracy.
5. Actual resampling equivalence check for sample zh-1: prepareAudio, direct native AudioContext({sampleRate:16000}) and ffmpeg all yield 76458 samples. Prepared/native waveform correlation 0.99999980; prepared/ffmpeg 0.99997650. RMS values agree to about 0.025%. No evidence of sample-rate/speed corruption on this sample. See resample-result.json.
6. Existing real_flow.py advances the replay sample on getUserMedia calls, not turn boundaries; the app reuses streams. Saved three transcript examples derive from the same public utterance. It proves three inference completions and storage/manual handling, not three independently assigned speech inputs. Keep that limitation in reports and strengthen future end-to-end tests.

## Actual glossary API experiment

Audio: PolyAI/minds14 zh-CN train row 1, reference `我想查询我目前的账户余额`.
Glossary: `银行账户，账户余额，查询。`. Reference includes 12 normalized characters. Each mode uses the same decoded waveform and Base q8 model within one browser session.

- Baseline: `莫向查詢:我目前的張婦宇兒`.
- prompt_ids: identical to baseline, indicating ignored context.
- decoder_input_ids, uncleaned: ` 银行账户，账户余额，查询。莫向查询。` (prompt echo).
- decoder_input_ids, token-prefix stripped: `莫向查询。` (rest of speech omitted).

See probe-result.json for exact tokens, normalized results, edit counts and CER; probe.py reproduces original API outputs. This is an API/domain-conditioning diagnostic, **not a held-out accuracy benchmark** (glossary terms were selected with knowledge of this sample). Do not claim the conditioning improves TCL recognition.

## Recommendation

Keep model conditioning off in shipped candidate until actual TCL corpus validates gains and hallucination control. A local user-reviewed script/term source can help exact spelling normalization and create a reproducible domain test set. Explicit aliases should be narrow and preserve raw transcript, manual edits, numbers/model suffixes; fuzzy product/price/spec substitutions would risk manufacturing claims. Explain OpenCC is script conversion, not acoustic recognition training or semantic correction.
