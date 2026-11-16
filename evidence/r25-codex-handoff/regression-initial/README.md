# Codex 独立 R25 回归复跑结果

来源提交：`910b3a1c8ff7c6e2c6452b9acaeb1e2dac1d2b08`。
app SHA-256：`635ed0ea61402fe6277a5bed2c9d2887b6c8b1cfab05d7d90608006558efb60f`（运行前后相同）。

**13组Node + 4组Python浏览器测试全部退出0。** 本轮运行未修改任何产品或仓库文件；git工作区保持干净。没有脚本适配，没有失败后重跑。所有结果均为本轮新执行，非沿用Claude日志。

环境：Node v24.22.1；Python 3.12.14；Chromium 156.0.8078.79 built on Debian GNU/Linux 13 (trixie)。

| 测试组 | 退出码 | 秒 | 实测范围 |
| --- | --- | --- | --- |
| assignment-regression.cjs | 0 | 0.032 | MOCK |
| manual-clear-regression.cjs | 0 | 0.065 | MOCK |
| r25-routing.cjs | 0 | 0.065 | MOCK |
| regression.cjs | 0 | 0.065 | MOCK |
| app-queue-wakeup.mjs | 0 | 0.165 | MOCK |
| audio-locks.mjs | 0 | 0.215 | MOCK |
| bridge-delivery.mjs | 0 | 0.265 | MOCK |
| bridge-worker.mjs | 0 | 0.167 | MOCK |
| bridge.mjs | 0 | 0.115 | MOCK |
| glossary.mjs | 0 | 0.033 | MOCK |
| performance-progress.mjs | 0 | 0.064 | MOCK |
| question-pool.mjs | 0 | 0.065 | MOCK |
| r25-bridge-release.mjs | 0 | 0.265 | MOCK |
| record-cache.py | 0 | 5.736 | Chromium synthetic/mocked Whisper |
| session_concurrency.py | 0 | 15.612 | Chromium synthetic/mocked Whisper |
| session_smooth_recovery.py | 0 | 15.765 | Chromium synthetic/mocked Whisper |
| browser_smooth_e2e.py | 0 | 8.49 | Chromium synthetic/mocked Whisper |

浏览器细项：record-cache 10检查、concurrency 10检查、recovery 10检查均通过；三题MediaRecorder/Worker模拟转写流程15步完成。四组浏览器报告页面errors均为空。下载进度合并模拟5检查通过。

范围限制：Node推理为模拟；Python使用真实Chromium/IndexedDB/MediaRecorder与合成数据，但Whisper输出为模拟。未在本分工执行真实Vosk模型flow、真实Whisper权重、真手机、大陆网络或真人TCL语音准确率。不能将本结果表述为真实语音准确率通过。

完整命令、退出码、耗时、日志SHA在`execution-log.json`；原始stdout/stderr位于`logs/`；各浏览器JSON和截图按record-cache/concurrency/recovery/recording分目录保留。任务专用复跑驱动为`run_regressions.py`，仅设置输出目录并顺序执行原脚本。
