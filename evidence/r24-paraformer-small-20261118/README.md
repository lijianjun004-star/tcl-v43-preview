# R24 Paraformer-small 轻量候选

用户反馈 SenseVoiceSmall 网页资源和运行负担过大。本候选选择 Paraformer-small int8，以普通话修复 PR #147 的 `d83b3ec325ea85aa54a0c3fe25f128783177d214` 为基线。HTML、CSS、角色选择和只填姓名的入口沿用 R24。

## 转写与运行开销

- 新浏览器默认使用 Paraformer-small 逐题和整场转写。已有明确的 Base／Tiny 选择继续有效，备用 Vosk 保留。语音在浏览器内转写，无需付费转写 API 或密钥。识别原文、简体转换、人工修改和清空的保存规则沿用当前候选。
- 网页核心模型与运行文件由 SenseVoiceSmall 的约 252 MB 降到 **94,223,635 字节**，减少约 63%。模型在初次转写时读取并核对固定 SHA-256。离线试用包含模型文件，解压后可通过本机网页运行。
- 模型版本为 sherpa-onnx v1.12.20 发布的 Paraformer-small 单线程 WASM。模型与词表和此前 CPU 测试逐字节一致。下载文件与内存指标分别记录。

## 识别复验

在桌面 Chromium 上通过候选 Worker 实际处理 12 条公开普通话录音，沿用此前同一组、同一 PCM 和简体计分口径。Paraformer-small 字符错误为 **10/222（4.50%）**，SenseVoiceSmall 为 4/222（1.80%），此前 Whisper Base 为 49/222（22.07%）。

## 同机浏览器内存实测

使用同一台 Linux 桌面、同一 Chromium 可执行文件、独立新浏览器与空缓存、同一组 12 条音频。Linux `/proc` 进程树经 Chromium CDP 核对覆盖渲染、浏览器、GPU 等进程。PSS 对共享页按进程分摊，报告浏览器进程树的采样峰值。

| 指标 | SenseVoiceSmall | Paraformer-small |
| --- | ---: | ---: |
| 核心模型及运行文件 | 约 252 MB | 约 94 MB |
| 冷加载 PSS 峰值 | 1487 MiB | 863 MiB |
| 推理期间 PSS 峰值 | 1556 MiB | 896 MiB |
| 转写渲染进程的 RSS 峰值 | 1044 MiB | 544 MiB |
| 12 段推理用时，排除加载 | 15.69 秒 | 4.40 秒 |

轻量版在这次桌面测试的推理峰值 PSS 下降约 **42.4%**。两款官方运行时的 WebAssembly 初始地址容量均为 512 MiB。另测 Paraformer 以 32／64 MiB 起步时，最终地址容量约 229 MiB，识别文字相同，渲染进程的驻留内存峰值仍约 618–620 MiB。本候选采用未经改动的官方 WASM。桌面 PSS 与手机峰值分别验收。

实体手机、真实 TCL 现场口播和大陆网络仍待复验。

## 练播流程复验

- 390 px 角色入口、姓名页及工作台对照 33/33。HTML、CSS 和原有布局保留，现有模型设置中的文字更新。未保存过模型时默认 Paraformer-small，已明确保存 Base／Tiny 时继续沿用。
- 浏览器原生录制及复盘 22/22。使用公开人声音频，经原生 MediaRecorder 和实际 Paraformer 模型走过逐题、整场和回放流程。人工编辑、清空后的恢复以及音频与录像哈希核验通过。
- Node 原有套件 20/20。桥接协议 8/8，输入过滤 41/41，覆盖静音、纯音及原始普通话样本。

## 资源来源

运行库、模型来源及原始文件哈希已固定。基础模型的官方资料列 Apache 2.0，精确的小模型 ONNX 转换仓库未提供明确许可字段。候选的本机推理无需调用付费服务，公开分发许可按资源文档记录。[可复现资源和许可](../../experiments/r24/PARAFORMER-ASSETS.md)

## 试用

完整 ZIP 共 35 个静态文件，另附试用说明。压缩包 78,164,570 字节，SHA-256 为 `39d350415347f834ad3ca7a82711766a88bea1027e7bffd9b4e6015d6f69e60a`。解包后逐项哈希与 CRC 核验通过，网盘已核对下载引用及长度。

解压到独立目录，执行 `python3 -m http.server 8877 --bind 127.0.0.1`，然后在 Chrome 打开 `http://127.0.0.1:8877/tcl-v352-asr-r24-qa/`。[含模型试用包](https://drive.google.com/file/d/100VIWY8a81Zurvs1PbP200nwHyTSyE-j/view?usp=drivesdk)

本次保持独立候选，没有合并或正式部署。线上原版以及用户本机记录保持原状。[上一候选回滚包](https://drive.google.com/file/d/1jMxlm_RFSj8da5CEIMwwjmy-pkNAkBvQ/view?usp=drivesdk)

## 私有试用反馈修复

`r24-paraformer-small-20261118-fix1` 修复知识点搜索、产品规格题型号检查和固定教学价格题的平台措辞。合并后的候选在桌面 Chromium 通过 17 项题库 UI 回归，涵盖导入、审核、知识库和三题轮换。使用公开普通话 WAV 经浏览器原生设备模拟录制，验证实际 Paraformer 加载、逐题识别、回放及下载失败后的补转写。正式 R24 和 R25 入口、题库资料和历史记录保持原状。

私有试用站首版已通过同源授权 GET 核对 38 项静态文件。四个模型分片拼接后共 82,547,881 字节，SHA-256 为 `9b89b7afaf5375704e758e85e88955abab381f81c466b24ecc7320b24d81b80f`。本次采用同一模型与同一试用入口。试用站登录由托管平台负责，练播房进入仍填写姓名。[私有试用](https://tcl-r24-paraformer-trial-20261118.lijianjun004.chatgpt.site/)

修复版离线 ZIP 共 35 个静态文件，78,211,525 字节，SHA-256 为 `7a4dcf26b589609571abfe25cb56c8d937e164a29f3cf4abae04aec8a7f0cda5`。实体手机麦克风和用户登录会话仍待验证。[同一模型的首版回滚包](https://drive.google.com/file/d/100VIWY8a81Zurvs1PbP200nwHyTSyE-j/view?usp=drivesdk)
