# 给 Codex 的 R2.5 接力任务书

任务：TCL-R25-ASR-FALLBACK-20261116 · 起草：Claude · 接手：Codex

用户原话：“按方案做 R2.5，在独立路径测试，把你的思路打包交给 codex”。
用户先前的边界依然有效：**没有用户的明确批准，不合并正式代码，不部署或覆盖现有站点**；不能把模拟测试通过当成真实识别成功；没实际跑的项写 NOT RUN；零新增 API 费用。

先读 `experiments/r25/R25-REPORT.md`，看清楚改了什么、哪些已经验证。

## 0. 先核对

1. 分支 `fix/r25-asr-fallback-20261116` 基于 main `d277aab`（PR126）。如果 main 已经前进，先 rebase，产品文件不应该冲突（只新增了 `experiments/r25/`）。
2. `experiments/r25/tcl-v352-asr-r25-qa/static-manifest.json` 里的哈希要和实际文件一致（逐个计算 sha256 对比）。
3. R2.5 由 R24（app `63519c50…`）机械打补丁生成：`experiments/r25/tools/patch_r25.py <R24源码目录> <输出目录>`。每个替换点都断言命中次数，基线不对会直接报错。要改代码，请改补丁脚本再重新生成，或者在报告里写清楚是手改的。

## 1. 要解决的问题和思路（为什么这样改）

用户在 iPhone 真机上报了三个问题：录完音回答栏是空的、出现繁体字、整条链路不可靠。R24 修好了繁体字。问题 1 的根因有三层，Claude 已在 Chromium 里复现（外部请求全部在本机拦截，用真实 Vosk 模型）：

| 根因 | R24 行为 | R2.5 改法 |
|---|---|---|
| Whisper 是唯一的自动引擎 | 首次使用要从 jsDelivr 加载运行库、从 HuggingFace 下载约 77MB 模型；这一步一失败，回答栏就是空的 | **默认改用 Vosk**（本站同源提供、42MB、已校验 SHA、直接输出简体）。进入开播前页面就自动开始下载，有进度条。Whisper Tiny/Base 保留为可选的实验引擎 |
| Whisper 失败后不会自动用 Vosk | 只有 Vosk 已经提前下好才会回退，否则提示“可手动填写” | 失败后自动开始下载 Vosk；下好后已有的 `enqueueRecordedQuestions()` 会补转所有还没文字的题；本页后续的题直接走 Vosk |
| 超时后 Vosk 也被锁住 | `isResourceBusy` 包含 `unhealthyReason`，超时后永久为 true，自动回退和「补转写」都被拦下，只能重开页面 | Whisper 现在跑在独立 Worker 里，可以直接终止：超时就 `terminate` 并清空引擎状态；本页继续禁用 Whisper，但不再锁 Vosk。页面级注入的 pipeline（只在测试里用）停不掉，仍按原逻辑锁住 |

另外两处小改动：
- OpenCC 转换预设从 `tw` 改为 `twp`，把台湾说法也转成大陆说法（支援→支持、软体→软件、萤幕→屏幕）。型号、数字和单位实测不变。
- Vosk 模式下，界面上的“备用 Vosk”改叫“中文识别模型 / 本机中文识别”。

命名空间全部换成 r25，避免读写 R24 的数据：
- IndexedDB：`tcl-specialty-v352-asr-r25-qa`
- BroadcastChannel：`…-workflow`
- Vosk 缓存：`…-vosk-v1`
- localStorage：`tcl-r25-asr-engine`、`tcl-r25-asr-diagnostics`
- 私有术语表：`tcl-r25-private-asr-terms-v1`

## 2. Codex 要做的事（按顺序）

### P0 测试部署（必须先获得用户明确批准）
- 新路径 `/tcl-v352-asr-r25-qa/`。参照 R24 的 `experiments/r24-release/` 和 `release-ci/` 门禁，做一份 R2.5 归档和 staging 脚本。改 CI 或门禁要单独提 PR，**不得放宽现有 SHA 白名单**，旧路由（R6 / R2.1 / R2.3 / R24）必须逐字节保持不变。
- 发布后从公网逐个读取 22 个文件，核对 HTTP 状态码和哈希。

### P0 iPhone 真机验收（请用户配合）
步骤写在 `R25-REPORT.md` 第 5 节。每题都导出诊断（复盘页的诊断导出按钮），**不要公开上传真人录音**。

### P1 代码层面的后续改进（可选，每项都要配测试）
1. **jsDelivr 是单点**：Whisper 运行库只从 jsDelivr 加载，HF 镜像救不了这一层。可以评估把 transformers.js 3.8.1 的 ESM 和 wasm 放到同源 vendor 目录（体积、许可证、SHA 锁定），或者干脆让 Whisper 只在用户手动选择时才使用（R2.5 当前就是这样）。
2. **超时后重试镜像**：R2.5 超时后不重试。既然 Worker 已经可以终止，可以新建一个 Worker 改用 `hf-mirror.com` 再试一次，但要保证最多两次、不并发、能取消。
3. **Vosk 缓存共用**：R24 和 R2.5 的 Vosk 缓存名不同，从 R24 换到 R2.5 要重新下载 42MB。模型文件完全一样且都校验 SHA，可以考虑只读复用 R24 的缓存（只读不写，保持隔离）。
4. **整场转写 / 「补转写」入口**：在 Vosk 模式下也要核对 `transcribeSessionVideo` 等次要入口的文案和行为是否一致。

### P1 真实语音验收
- 获得授权后，建立真人普通话语料：每题 3 到 5 句，包含 TCL 型号、尺寸、价格、HDMI 2.1、144Hz 等。按题计算 CER，并单独统计型号和数字的准确率。
- 目前只用 espeak-ng 合成语音测过链路。它的发音很机械，识别出来基本不对，**不能拿来证明准确率**。

## 3. 怎么复跑 Claude 的测试

```sh
# 依赖：node>=18、全局 playwright、Chromium、Python Playwright
# 真实 Vosk 模型：live-practice-room 仓库 voice/ 目录（12 个文件）放到 /home/user/live-practice-room/voice
#   或者修改 r25-flow.cjs 里的 VOICE 常量
bash experiments/r25/tests/run-r25-all.sh "$PWD" <含 tcl-v352-asr-r24-qa 的R24目录> /tmp/r25-results experiments/r25/tests/audio
```

- 第二个参数是 R24 源码目录，在仓库里就是 `experiments/r24`，用于 R24 对照。
- 浏览器场景测试会在本机拦截所有外部域名（`MODE=abort` 让请求直接失败，`MODE=hang` 让请求挂起不响应），并且把加载超时调成 6 秒，以便快速触发超时路径。
- 迁移过来的 R24 Python 浏览器测试固定选 Whisper Tiny，保持和 R24 一样的被测路径（Whisper 推理是模拟的），并且不会自动下载 Vosk。

## 4. 禁止事项

- 不修改或覆盖 `tcl-v352-asr/`、`tcl-v352-asr-autoqa*/`、`tcl-v352-asr-r24-qa/`、根入口、`site.zip`、`live-practice-room`、`tcl-live-monitor`。
- 不在页面里放任何密钥，不接付费 API，不上传真实员工录音或商业数据。
- 不把 Gemini 或其他模型报告里“全部通过”之类的话当作证据；只认实际命令、退出码和哈希。
