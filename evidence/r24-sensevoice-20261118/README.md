# R24 免费 SenseVoiceSmall 普通话候选

用户选择同批实测字错率最低且无需付费 API 的模型。本候选以 R24 普通话修复 PR #147 的 `d83b3ec325ea85aa54a0c3fe25f128783177d214` 为基线。角色选择、姓名进入、HTML、CSS、训练与本机存储沿用原版。现有语音设置增加 SenseVoiceSmall，已有 Base／Tiny 选择保留。

## 转写路径

- 初次进入采用 SenseVoiceSmall int8。逐题自动转写与整场主转写由现有模型选择控制。备用 Vosk 继续使用原按钮和原静音校验。准备或使用 Vosk 前释放闲置的 SenseVoice Worker。
- 模型固定为简体普通话使用场景的 `language: zh`，开启 ITN。识别文本继续通过原 OpenCC 与口述数字流程。逐题和整场均保留原始识别文字，保护用户编辑与原始音视频。
- 模型在单线程 WebAssembly Worker 首次识别时准备。固定 SHA-256 校验每个资源，分片放在同源静态路径。音频在本机处理。无付费模型、API 密钥或上传服务。
- 短录音按原始采样完整送入模型。长录音按不超过 30 秒的连续区间识别，在边界附近优先按较低能量处切分，音频无重叠或丢弃。超时、取消或资源错误关闭 Worker；新一场练播或用户明确重新转整场可重试。
- 数字静音、直流信号和符合单一平稳振荡条件的纯音不会触发模型，避免纯音被写成回答。保留真实语音原始波形和有意重复的词句；SenseVoice 路径沿用简体和数字规则，关闭 Whisper 专用删词规则。

## 模型与浏览器证据

沿用同一批 12 条公开普通话录音，参考文字 222 字。SenseVoiceSmall 和 Qwen3-ASR 0.6B int8 在此前对照均为 4/222，选中的 SenseVoiceSmall 浏览器方案较轻。本次在 Chromium 实际运行候选的 WebAssembly 和 Worker，依然为 **4/222，1.80% 字错率**。12 条全部完成，16 项浏览器检查通过。所有网络请求为同源 GET／HEAD，声音始终留在浏览器。对比基准为 Whisper Base 49/222，Vosk 38/222，Paraformer-small 12/222。

浏览器上游包为 sherpa-onnx v1.12.20 单线程版。包内 ONNX 权重和词表与此前原生测评逐字节相同。14 个资源和许可文件合计 252,193,445 字节。三个模型分片各不超过 80 MiB，上游 WASM 初始内存为 512 MiB。

[SenseVoiceSmall 上游权重](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) · [固定浏览器运行库](https://github.com/k2-fsa/sherpa-onnx/releases/tag/v1.12.20) · [候选资源复现](../../experiments/r24/SENSEVOICE-ASSETS.md)

## 练播复验

| 检查 | 结果 |
| --- | --- |
| 390 px 姓名入口和工作台 | 31 项通过。角色入口和两种姓名流程原图一致。主播首页原有模型提示处更新文字，界面布局及 CSS 沿用。明确保存的 Base／Tiny 保持生效。 |
| 练播录制与整场复盘 | 22 项通过。公开录音经虚拟设备、真实 MediaRecorder 和真实 SenseVoice 处理。原音频与录像 SHA 不变，能实际回放；刷新保留原识别文字、人工稿和单独候选。手动清空整场后保存并刷新，随后重新识别，空白人工稿保留。 |
| 下载错误及原浏览器重试 | 10 项通过。故障期间音频原样保留并可播放，识别文字为空；资源恢复后用户明确重试，真实识别成功。 |
| 回归 | 现有 Node 套件 20/20。新桥接确定性检查 8/8，覆盖短音频不删样本、静音不加载、长 PCM 连续切分、超时释放、显式重试、取消和异常结果。 |
| 输入过滤检查 | 41 项通过。涵盖静音、纯音、同批 12 段语音及低音量副本。真实浏览器先复现纯音错写「我」，该条件现在返回空结果。 |
| 长录音、静音及模型重载 | 浏览器功能 10/10。1 秒静音和 440 Hz 纯音均无文字且无模型加载。38.229 秒重复语句连续分为两段，8 次重复均保留，长样本仍有 3/96 字符错误。释放后同一页面可重新加载。 |

后续真机验收涵盖 iPhone 内存、实体录音设备、大陆网络和 TCL 现场话术。当前公开语料结果可用于模型相对比较。

## 试用与发布边界

试用 ZIP 打包 38 个网页、模型与许可资源，另附《试用说明》。完整 ZIP 为 164,209,513 字节，SHA-256 为 `596faaab42c2cff73c0619e8b2637e2553c8ce42d97daeec6546fc75d1759dc8`。包内文件逐项比对和 CRC 校验通过。

网盘下载分两卷。把两个文件放在同一目录，用下面的命令合成完整 ZIP，再解压并照包内说明在本机 Chrome 打开。

[下载分卷 1](https://drive.google.com/file/d/1oCNnoOJvPpXNSg0TDqj7fiqjdk94Rpj2/view?usp=drivesdk) · [下载分卷 2](https://drive.google.com/file/d/1eVGlWJXqUT8fyg6I__NloDQo6uSlN4wx/view?usp=drivesdk)

```sh
cat TCL-R24-SenseVoiceSmall-20261118.zip.001 TCL-R24-SenseVoiceSmall-20261118.zip.002 > TCL-R24-SenseVoiceSmall-20261118.zip
```

Windows 命令提示符可用 `copy /b` 合并同名两卷。本机试用 ZIP 已含模型，首次运行读取本地资源。原 R24、R25 与用户历史数据本轮保持现状。候选通过独立草稿评审，正式发布待用户确认。

[上一候选回滚包](https://drive.google.com/file/d/1jMxlm_RFSj8da5CEIMwwjmy-pkNAkBvQ/view?usp=drivesdk)
