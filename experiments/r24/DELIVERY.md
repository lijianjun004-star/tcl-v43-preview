# R2.4 练播房交付验收

任务：TCL-R24-DELIVERY-20261116。负责人：当前 ChatGPT/Codex；Gemini 复验以实际返回记录为准。
来源：用户 TCL-R24-Terms-QA.zip（SHA-256 `1c4768ca06577fb12e9c1d1397fdb9e4c3b5aa7e66aa034c1658c2b736873030`），与 PR104 `d4d8057f74d93be897b1bb034b3e1d348c9e7562` 文件逐字节一致。原 main 为 `b672281725392a2e23e656dd5ff410531f660175`。

本轮范围是当前本机练播房的修复、运行与独立路径交付。GitHub Pages 继续托管；不新增收费服务、模型 API、真实鉴权或跨设备后端。旧根站、原12周站、R6、R2.1、R2.3 与浏览器数据均保留。

## 这次处理的问题

- 转写队列取消/新场开始交错时误删新场首题；多个等待任务同时进入同一 Whisper 引擎。
- 整场与逐题转写重复加载不同 Transformers/Whisper 模型；未完成底层任务超时后的资源互斥。
- 人工清空的回答在记录或运营提交中被旧识别原文重新填回。
- 刷新后无法重新打开本场文字、已停止的单题录音和已完成录像；保存异常缺少持续提示。
- 作业保存/加入期间切换身份导致迟到回调进入错误界面。
- 导入预览没有随文件/目标板块变化失效、重复保存、离开页面后的迟到解析报错；批量写库中途失败。
- 畸形 XLSX 列号可能导致巨大数组；损坏 Office ZIP 缺少 CRC/头部/目录一致性校验。
- 默认逐题使用 Whisper，却显示全部首载模型仅42MiB的误导提示。
- R24 原 PR 被发布门禁拒绝。按独立 CI 策略→精确静态归档发布的方式拆分，不取消旧保护。

## 使用与数据

选择主播、输入本机姓名，进入自由练播或本机运营作业。首次语音识别需要联网下载所选免费模型；弱设备可手动选择 Tiny。允许纯文字练播；转写结果需要人工核对。

结束后进入复盘，检查本机保存状态，查看录像及逐题文字；明确提交后才显示给本机相应运营。刷新后重新输入同一姓名可恢复最近一场已成功保存的部分。姓名是本机便捷标识，不是账号密码认证；这些记录不会送达另一部手机。

录制仍有8分钟/约64MB保护；整场解码/转写限180秒、48MB。单题录音最长120秒；恢复媒体预算96MB/200题。正在录制、尚未停止或保存失败的片段无法保证恢复；清理浏览器数据会删除本机保存。重要音视频应下载备份。

## 验证的含义

验收计划和本轮结果放在 `evidence/r24-delivery/`。`evidence/r24/` 与 `evidence/r24-domain/` 为原包历史记录，不能冒充本轮全部重跑。

- Chromium + 合成摄像头/录音 + 模拟模型用于队列、UI、人工修改、原生 IndexedDB、刷新和异常回归。
- 免费 Whisper Base/Tiny 与 Vosk 确实加载并识别公开真人普通话录音；语料为3条电话银行问询，非TCL业务语料。Base CER 13/44，Tiny 23/44；不能当作TCL准确率放行。
- AAC/MP4、WebM/Opus、WAV解码测试运行于Linux Chromium；不是iPhone Safari真机。
- 320/390 CSS像素视口检查不等于真实手机。当前没有iPhone/Android硬件、中国大陆网络实测，未读取历史244条私有讲解词。WebKit安装因系统依赖权限不足未运行。
- 术语功能只整理明确英文词的大小写/空格/连字符；不训练模型、不补写未说出的型号价格、不自动评分。

## 可复跑

需要 Node、Python 3、Python Playwright 与 Chromium。浏览器脚本使用临时本地服务器和合成资料；关闭时释放服务器与浏览器。真实模型脚本会下载免费模型，不访问付费API。

```sh
node experiments/r24/tests/regression.cjs
node experiments/r24/tests/glossary.mjs
node experiments/r24/tests/bridge.mjs
node --test experiments/r24/tests/bridge-delivery.mjs
node experiments/r24/tests/assignment-regression.cjs
python experiments/r24/tests/delivery_imports.py
python experiments/r24/tests/delivery_knowledge_import.py
python release-ci/test_release_guard.py
```

完整恢复与历史回调可运行 `python experiments/r24/tests/session_recovery.py`、`python experiments/r24/tests/history_recovery.py`；底层任务队列唤醒测试运行 `node --test experiments/r24/tests/app-queue-wakeup.mjs`。真实音频运行 `python experiments/r24/tests/download_samples.py`，再运行 `audio_delivery.py` / `vosk_delivery.py` / `audio_cache.py`（同一 tests 目录）。语料按 `download_samples.py` 下载；交付包不包含真人语音文件、模型权重、用户录音、凭据或浏览器登录数据。

## 发布记录

冻结 app SHA-256：`b086a0c5c9610f338d9c5ac86db631b191758c7bc4e7f50228777d6dd5144deb`；bridge：`b93887710d61766d01396f9eb6da357c3460519877fca595b08e793d9a1b41c4`。静态ZIP：`7dc19da8838015a9e870ac21c2672b57a273f342f657d9b254f495ee15ba08ef`。

CI PR：https://github.com/lijianjun004-star/tcl-v43-preview/pull/105 。原195个文件逐字节保留、新增21个；60项门禁、完整staging和精确回滚通过。最终源码的会话恢复10项、history2项、队列/文本14组、作业8项、资源锁及bridge8项、迟到队列唤醒2项和两套三题浏览器流程通过。文件格式/导入等六项完整浏览器脚本在仅pageshow回调变更前的609f源码通过，保留旧哈希，不冒充最终哈希。

发布与公网校验已完成，见下方记录。Gemini状态见源码分支 `fix/r24-delivery-20261116` 的 `evidence/r24-delivery/gemini-status.json`；Google登录已保存并在浏览器实测可用。此前Pro已明确挂载源码附件并发送1条请求，但仅回复“我只是一个文本 AI, 在这方面没法帮到你。”，未提供读取校验或复验内容。随后用户明确指定Argon；本次浏览器已选中“4 Argon（代码与分析）”，但附件入口操作未成功，因此Argon请求0次、累计业务请求1次，状态BLOCKED_ATTACHMENT_ENTRY。没有完成Gemini实质复验，不推测Pro回复原因，也不据一次界面操作外推Argon永远不支持附件。


发布完成：PR106 https://github.com/lijianjun004-star/tcl-v43-preview/pull/106 ，合并 `7c2c8c4429166654a63b9c20f2258ec1cfd31b7b`；Pages https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43923233532 成功。公网216/216资源HTTP200且哈希匹配，真实上线文字练播/复盘/刷新恢复PASS，零页面异常与外部请求。入口：https://lijianjun004-star.github.io/tcl-v43-preview/tcl-v352-asr-r24-qa/ 。

Gemini交接任务见 `GEMINI-REVIEW.md`；当前为BLOCKED_ATTACHMENT_ENTRY，累计1条Pro请求无实质复验、Argon已选中但0请求。上述发布和本机测试结论不变，真实手机与TCL语音准确度仍待验收。
