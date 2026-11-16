# Codex 最终 R25 回归复跑结果

被测app SHA-256：`2848488723324db8a897fcb0fc4cbe577916b0e3e01cce8e05922aed8c3d1bfc`（19组命令各自记录同一hash，运行前后相同）。
启动时Git HEAD：`910b3a1c8ff7c6e2c6452b9acaeb1e2dac1d2b08`，当时工作区已有本轮产品修复；完成时HEAD：`910b3a1c8ff7c6e2c6452b9acaeb1e2dac1d2b08`。精确内容以app及source-sha256.json为准，不能将最终hash误写为原910b3a1未改版本。

**15组Node + 4组Python浏览器测试全部退出0。** 本分工未修改产品或仓库文件；没有脚本适配，没有本分工失败后重跑。原635ed0ea版本证据仍独立留在`/workspace/r25-codex-regression/`。

regression.cjs排在最后执行，采用源码代理事先补齐`voskUi={state:"idle"}`的VM测试夹具；该代理先前遇到的旧夹具失败另存其evidence/r25-codex-review/regression.cjs.fixture-failure.log，不计作本分工执行。产品hash在这次夹具修订时未变。

环境：Node v24.22.1；Python 3.12.14；Chromium 156.0.8078.79 built on Debian GNU/Linux 13 (trixie)。

| 测试组 | 退出码 | 秒 | 实测范围 |
| --- | --- | --- | --- |
| assignment-regression.cjs | 0 | 0.065 | MOCK |
| manual-clear-regression.cjs | 0 | 0.033 | MOCK |
| r25-retry-policy.cjs | 0 | 0.065 | MOCK |
| r25-routing.cjs | 0 | 0.065 | MOCK |
| r25-session-engine-label.cjs | 0 | 0.036 | MOCK |
| app-queue-wakeup.mjs | 0 | 0.165 | MOCK |
| audio-locks.mjs | 0 | 0.266 | MOCK |
| bridge-delivery.mjs | 0 | 0.316 | MOCK |
| bridge-worker.mjs | 0 | 0.165 | MOCK |
| bridge.mjs | 0 | 0.115 | MOCK |
| glossary.mjs | 0 | 0.065 | MOCK |
| performance-progress.mjs | 0 | 0.065 | MOCK |
| question-pool.mjs | 0 | 0.065 | MOCK |
| r25-bridge-release.mjs | 0 | 0.315 | MOCK |
| record-cache.py | 0 | 7.126 | Chromium synthetic/mocked Whisper |
| session_concurrency.py | 0 | 16.155 | Chromium synthetic/mocked Whisper |
| session_smooth_recovery.py | 0 | 17.98 | Chromium synthetic/mocked Whisper |
| browser_smooth_e2e.py | 0 | 9.283 | Chromium synthetic/mocked Whisper |
| regression.cjs | 0 | 0.066 | MOCK |

浏览器细项：record-cache 10检查、concurrency 10检查、recovery 10检查均通过；三题MediaRecorder/Worker模拟转写流程15步完成。四组浏览器报告页面errors均为空。下载进度合并模拟5检查通过。

范围限制：Node推理为模拟；Python使用真实Chromium/IndexedDB/MediaRecorder与合成数据，但Whisper输出为模拟。未在本分工执行真实Vosk模型flow、真实Whisper权重、真手机、大陆网络或真人TCL语音准确率。不能将本结果表述为真实语音准确率通过。

完整命令、退出码、耗时、每条测试源码hash/被测app hash、原始日志hash在execution-log.json；原始stdout/stderr位于logs/；各浏览器JSON和截图按record-cache/concurrency/recovery/recording分目录保留。任务专用驱动run_regressions.py只设置输出目录并执行原脚本。
