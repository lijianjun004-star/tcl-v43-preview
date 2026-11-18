# R24 Paraformer 设备检测候选版 `r24-paraformer-small-20261118-devicecheck-rc1`

**状态：** 用户选择"开临时候选入口"后，以独立路由 `/tcl-r24-paraformer-rc/` 走门禁 PR #153 + 发布 PR 上线（见下方"临时候选入口"）。正式入口 `/tcl-r24-paraformer/` 保持 `pages1` 不变。

## 问题
进入准备页后，设备检测不会自动开始，界面却一直显示"正在检查摄像头和麦克风…/准备中…"，必须再点一次"检测摄像头与麦克风"才能开播（旧 R24 入口也一样）。

## 改动（仅 `app.js` + `static-manifest.json`）
基线是 main 上 `experiments/r24-paraformer-release/site-only.zip`（`7d8bcb0c…`，即线上运行的字节）。补丁可重复执行：`patch_devicecheck.py <解包目录>`，每处替换都断言恰好命中 1 次。

1. `openBoard()` 末尾：主播点「检查设备，准备练播」/「再练一次」/作业/板块进入时，在同一次点击里调用 `checkDevices()`。仍保持"只有用户点击才申请权限"，打开页面不会弹出权限请求。
2. 检测进行中用 `pendingSeq` 标记，只在检测真正进行时显示"正在检查…/正在检测设备…"；被取消的检测不会一直显示进行中。
3. 文案：未检测显示"请点击「检测摄像头与麦克风」"，按钮显示"请先检测设备"；失败时状态和弹出提示都显示"设备未就绪，请点击「检测摄像头与麦克风」重试，或选仅文字练播"。

| 文件 | SHA256 |
|---|---|
| `site-only.zip` | `e2909680cb1621356cd76222e3ff4307efe332118dfadf89655c114a4039cd0b`（306,426 字节） |
| `app.js` | `bb29a92a297ad1497d224f21ea347bc4c4daac56203e8bc7dff6fef3a4676e1a` |
| `static-manifest.json` | `cfb6349f264b311b15d9662a79a896da951cdcb6fe9eedafe95b34f4dfa63d96` |

其余 33 个前端文件与模型文件同发布包逐字节一致。

## 本地验证（Chromium，390×844 移动模拟，`127.0.0.1` 本地服务，模型文件与线上哈希一致）
| 测试 | 结果 |
|---|---|
| `tests/devcheck.js` 自动检测 / 模拟拒绝后允许重试 / 立即切文字练播 / 点击前不申请媒体 | 12/12 PASS（`results/devcheck.json`） |
| `tests/retry.js` 结束一场后点「再练一次」自动就绪 | PASS |
| `tests/full2.js` 真实 Paraformer：3 题录音转写→复盘→刷新恢复→回放 | PASS，pageerror 0、外部请求 0（`results/full-flow.log`） |

测试环境限制：无头 Chromium 不加 fake-UI 时 `getUserMedia` 恒为 `NotSupportedError`，线上版同样如此，所以拒绝权限用脚本模拟 `NotAllowedError`。

## 未做
- 实体 iPhone/Android/微信内置浏览器、大陆网络、真人口播。
- Gemini P3-1（术语大小写与数字转换顺序）未包含在本候选版中，见 `evidence/r24-paraformer-gemini-recheck-20261118/RECEIPT.md`。
- 已知但未修改：未就绪时摄像头占位区"摄像头未就绪"等文字与浮层文字重叠（旧版既有）。
- 发布需另行批准：要更新 `release_guard.py` 的固定哈希、拆分门禁 PR 和发布 PR，再部署 Pages。

## 临时候选入口 `/tcl-r24-paraformer-rc/`
同源部署需隔离本机数据，所以 RC 包 = 设备检测补丁 + `patch_rc_namespace.py`：

| 项 | 正式 | RC |
|---|---|---|
| IndexedDB / 通知频道 | `tcl-specialty-r24-paraformer-v1` | `tcl-specialty-r24-paraformer-rc1-v1` |
| 模型偏好 localStorage | `tcl-r24-paraformer-asr-model-v1` | `tcl-r24-paraformer-rc1-asr-model-v1` |
| 术语表 localStorage | `tcl-r24-paraformer-private-asr-terms-v1` | `tcl-r24-paraformer-rc1-private-asr-terms-v1` |
| 标识 | — | `<title>` 与身份选择页标注"候选版 RC1" |

模型 CacheStorage 按网址区分条目、不删除其他条目，保持共用名。RC 前端 ZIP `rc-route-site-only.zip` SHA256 `69a49036041c5b0286aef87bb799ade1f3ceb454cc2076b20891cf77ccdf1f17`（变更 app.js、glossary-ui.mjs、index.html、r23-model-choice.js、static-manifest.json）。

本地 RC 路由：设备检测 12/12、再练一次、真实 Paraformer 完整流程 PASS；`tests/isolation.js` 同源隔离 PASS（RC 看不到正式入口记录，两库并存）。门禁 211/211；模拟发布/撤销 PR 均 PASS；真实模型包本地全量 Pages stage 316 文件/193 MB。
