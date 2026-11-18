# Paraformer-small browser assets

Unmodified **k2-fsa/sherpa-onnx v1.12.20** single-thread SIMD browser runtime,
with the **Paraformer-small int8 (2024-03-09)** model. Model architecture and
original training are from Alibaba DAMO / FunASR; the small ONNX conversion is
credited by the official sherpa archive to ModelScope user **crazyant**.

Exact browser distribution:
https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.20/sherpa-onnx-wasm-simd-1.12.20-vad-asr-zh_en-paraformer_small.tar.bz2

Exact model conversion source:
https://www.modelscope.cn/models/crazyant/speech_paraformer_asr_nat-zh-cn-16k-common-vocab8358-onnx/summary

The conversion README identifies the base model as:
https://www.modelscope.cn/models/damo/speech_paraformer_asr_nat-zh-cn-16k-common-vocab8358-tensorflow1/summary

Licenses are component-specific:

- sherpa-onnx runtime: Apache-2.0, `LICENSE-sherpa-onnx.txt`.
- ONNX Runtime 1.17.1: MIT plus supplementary upstream notices,
  `LICENSE-onnxruntime.txt` and `THIRD_PARTY_NOTICES-onnxruntime.txt`.
- Silero VAD included in the upstream data bundle: MIT,
  `LICENSE-Silero-VAD.txt`. The product recognizer does not call VAD.
- The exact small-model conversion has no LICENSE file or nonempty license
  metadata in its public source repository as inspected. Attribution is
  retained here; this notice does not relicense the weights as Apache/MIT or
  claim that terms from another Paraformer model card apply to these weights.
  The exact DAMO base model referenced by its README resolves to the same-named
  IIC model in official ModelScope API metadata, which states Apache License
  2.0. This establishes the ancestor's license attribution; the conversion
  repository's own missing license metadata remains explicitly recorded.

`license-sources.json` records the exact URL, size and SHA256 of each included
license/notice. The prebuilt WASM archive supplies no license files.
Supplementary ONNX Runtime notices come from a pinned source snapshot of its
runtime distributor's fork, without claiming that snapshot is the build commit.
No alternate runtime has been substituted.

Only the untouched API JS, runtime JS, WASM and data bundle are staged.
The upstream demo page, demo application and VAD JS are omitted.
