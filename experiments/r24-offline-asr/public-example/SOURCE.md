# 中文合成口播样本

本样本由项目内编写的金标台词在本地 CPU 合成，用途是检查短口播转写和 TCL/T5M/T7M 型号保真度。脚本中没有真实姓名、客户资料或产品参数。未使用真人录音、用户声纹、付费语音合成或云端业务数据。

- 模型是中英双语 MyShell MeloTTS，模型仓库标注 MIT，附许可证。运行采用 sherpa-onnx 1.12.40 的 CPU VITS，单说话人 0，语速 1.0。[上游模型说明](https://huggingface.co/myshell-ai/MeloTTS-Chinese)
- 本地使用的量化模型为 `model.int8.onnx`，大小 53,517,430 字节，SHA-256 `f085f5079e05f039b800aeb542f5253c26a303211b0c6465d0d9387977855a63`。[固定转换版本](https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/tree/a0d5c6a264c0ef92d70d8661d8cc502d79627cd6)
- 金标保存于 gold.txt。为便于合成器读出型号，送入 TTS 时分别展开为“t c l”“t 五 m”“t 七 m”。最终音频下采样为 16 kHz，单声道有符号 16 位 PCM WAV，已固定 SHA-256。
- `acoustic-check.json` 为波形检查。独立离线 Paraformer 在不提供金标、提示词或热词时读出“请告诉我您看的尺寸我先核对官方资料……两款电视在日常使用中有什么差别”和两处“t 五 m”“t 七 m”，品牌末字母 L 等有误识。验证采用波形与独立语音识别，尚无真人听审记录。
- 调用在线模型时只上传 audio.wav。运行结束后在本地使用 `python3 compare-cer.py gold.txt openai-transcript.txt`。输出严格 CER、替换/删除/插入、逐字差异和五项关键词，保留型号混淆。
