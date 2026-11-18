# SenseVoiceSmall browser assets

This directory accompanies the unmodified single-thread SIMD browser runtime
from **k2-fsa/sherpa-onnx v1.12.20** and **SenseVoiceSmall**, by
**FunAudioLLM / Alibaba Group**. Model conversion and the WASM distribution are
provided by the sherpa-onnx project. Preserve these source and model names.

Official distribution:
https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-wasm-simd-1.12.20-vad-asr-zh_en_ja_ko_cantonese-sense_voice_small.tar.bz2

Official model and conversion information:

- https://huggingface.co/FunAudioLLM/SenseVoiceSmall
- https://github.com/FunAudioLLM/SenseVoice
- https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html

Licenses are component-specific:

- sherpa-onnx runtime: Apache-2.0, `LICENSE-sherpa-onnx.txt`.
- SenseVoiceSmall model weights: FunASR Model Open Source License Agreement
  v1.1, `LICENSE-SenseVoice-model.txt`. In particular retain attribution and the
  model name. This model license is separate from the runtime's Apache license.
- The upstream data bundle also includes Silero VAD, although the product
  recognizer does not call it: MIT, `LICENSE-Silero-VAD.txt`.
- ONNX Runtime 1.17.1: MIT and its accompanying third-party notices,
  `LICENSE-onnxruntime.txt` and `THIRD_PARTY_NOTICES-onnxruntime.txt`.

`license-sources.json` records the exact source URL, size and SHA256 of each
included license/notice. The prebuilt WASM archive does not carry license files.
Supplementary ONNX Runtime notices are retained from a pinned source snapshot
of the runtime distributor's upstream fork. That source revision is recorded
without claiming it is the exact build commit; no different runtime is
substituted for the binary in the pinned sherpa release.

The original `.data` bytes are split only for transport and reassembled without
modification. The original runtime JS, API JS and WASM bytes are unchanged.
The upstream sample web page, sample app and VAD JS are omitted.
