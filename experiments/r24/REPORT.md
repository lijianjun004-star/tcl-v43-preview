# TCL R2.4 复验与修复候选

任务 TCL-ASR-R24-20261116；领域：前端 ASR；负责人/执行者：当前 ChatGPT/Codex 环境。
基线：实时 main b672281725392a2e23e656dd5ff410531f660175，与上传的 R2.3 14 文件一致。
预算：零付费 API，未调用 Gemini；所有识别在云端 Chromium 本地 WASM 运行。
状态：候选可审阅，**未合并、未发布，未通过手机产品验收**。

## 修复内容

- OpenCC-js 1.4.2 的 tw→cn 词级转换替代有限字符表；词典静态打包 109060 字节，保留 MIT、Apache-2.0 和第三方声明。语音识别评估统一入口覆盖 Whisper、Vosk、浏览器识别；候选采纳也转换。人工文字不强制改写，rawTranscript 保留原文，含人工回答保留时的模型原文。
- 修复失效推理返回时 double shift：原代码在 try 内移除队头后，finally 再移除一次，会静默跳过下一题。现在完成任务只出队一次。
- 录音停止回调只读所属题输入，防止读取下一题编辑框；暂存复盘期间继续按原 run 写入记录。保留 runId/turnId/audioRevision、取消序号与人工修改保护。
- 提供模型下载字节进度、模型就绪/写入状态和匿名诊断导出。诊断仅含阶段、模型、题目序号、时间、音频格式/字节/时长/RMS，不含姓名、转写、音频或令牌。
- 修复强制镜像选项未实际设置镜像的问题。保留加载/推理超时后禁重入策略，避免未结束的 WASM 与第二份模型并发。
- 独立路径 tcl-v352-asr-r24-qa、独立 IndexedDB/模型设置键；旧版与其历史数据保持原样。**候选不会自动迁移旧版数据**。
- 根据本次实测保留 Base 默认值；Tiny 作为低内存手动选项，不能承诺精度相同。

## 实测证据

| 范围 | 结果 | 限定 |
|---|---|---|
| 原包 14 文件、13 资源清单 SHA | PASS | 原始静态包，不是语音验收 |
| 原繁简缺陷复现 | FAIL（缺陷已复现） | 這/們/紹 未转换 |
| 新转换及逐题队列回归 | PASS，12 项断言组 | 运行实际 app 函数，VM 推理模拟 |
| 音频预检/静音/超时禁重入 | PASS | 合成 AudioContext，不是设备 |
| 原 release_guard 测试 | PASS，44 项 | 未修改门禁及 allowlist |
| Chromium 三题模拟 | PASS | MediaRecorder 合成正弦波，模型结果 mock |
| 真实模型中文语音 | 处理链路 PASS，两模型各 3 段 | PolyAI/minds14 zh-CN train 0–2，公开真人银行问询语料，非 TCL 产品样本 |
| 真人语音回放 + 三题完整页面 | PASS，见 evidence/r24/real-flow.json | REAL Tiny + MediaRecorder + 复盘/IndexedDB；音源为公开录音回放，不是真实麦克风讲话 |
| iPhone Safari / 微信 / Android 真机 | NOT RUN | 无真实设备 |
| 大陆网络冷启动、缓存离线、Vosk 真模型 | NOT RUN | 不以云端网络代替 |
| 刷新后会话/媒体完整恢复、存储配额失败 | NOT RUN | 原程序仍有会话媒体在内存的限制 |
| MP4/AAC Safari、内存压力、后台页恢复 | NOT RUN | 本轮 Chromium 不可替代 |

浏览器：Chromium 156.0.8078.79，Linux 云端网络。HF、hf-mirror 和 jsDelivr 配置/运行时探测 HTTP 200；真实 Whisper 主源下载成功。镜像完整权重下载未测，中国大陆可达性未测。

真实模型原文与结果保留在 real-model*.json。CER：先 OpenCC 简化，去空白/标点/符号、英文字母小写，再按 Unicode 字符 Levenshtein 编辑距离 / 参考字符数。3 段共 44 参考字：Tiny 23/44=52.27%，Base 13/44=29.55%。WER 未算（未做中文分词）。这组样本很小且非业务领域，不能外推总体精度；**准确度不放行**。首次单段含加载耗时：Tiny 6.14 秒、Base 12.56 秒；后两段约 Tiny 2.2 秒、Base 4.0 秒；仅该云端设备，不是手机耗时或峰值内存测量。

## 本地复跑

在仓库根目录运行：

```sh
node experiments/r24/tests/regression.cjs
node experiments/r24/tests/bridge.mjs
python3 experiments/r24/tests/download_samples.py
R23_SITE_ROOT="$PWD/experiments/r24" R23_BROWSER_REPORT="$PWD/evidence/r24/browser-mock.json" python3 experiments/r24/tests/browser_e2e.py
python3 experiments/r24/tests/real_model.py
ASR_PRESET=base python3 experiments/r24/tests/real_model.py
R23_SITE_ROOT="$PWD" R23_BROWSER_REPORT="$PWD/evidence/r24/real-flow.json" python3 experiments/r24/tests/real_flow.py
```

需要 Node、Python Playwright、/usr/bin/chromium 和可用外网。真实测试会下载模型；不调用付费接口。公开语料见 https://huggingface.co/datasets/PolyAI/minds14 ，下载原始数据的许可及使用条件以源数据卡为准，未将音频上传仓库。

## 交付与回滚

只提交独立源码/测试/证据和 AI_CONTEXT 更新；site.zip、Pages 工作流、release_guard 均不动。Draft PR 不触发新页面发布。候选不是可直接覆盖当前 site.zip 的发布包；未来发布需要按原门禁单独审计新路径，不得放宽旧 SHA 检查跳过失败。
当前线上无需回滚；撤销候选可关闭 Draft PR。以后发布必须保留旧路径，通过新的 PR 回滚，不清理浏览器数据。
