# TCL 练播房 R2.3｜免费离线语音识别模型优化（独立候选）

## 先读结论
- **不调用任何 OpenAI / ChatGPT 付费 API**。本实验使用浏览器端 Transformers.js 3.8.1 + 多语言 ONNX Whisper。
- 基于正式上线的 R2.1 ESM 修复版 `app.js` SHA-256: `86ca65f2c0f898e0953193c1489ae6221c06aa3dea57b7187113465249d727e4`，只在新的 `tcl-v352-asr-autoqa-r23/` 目录中构建。
- 保持逐题录音 Blob → 对应题目文字栏回填、人工编辑不覆盖、防串题、结束流程与超时禁止重入保护。
- 右上角“其他工具”展开后选择 **Tiny 轻量模式** 或 **Base 增强模式**；**本独立实验默认 Base 增强**，Tiny 可随时作为低内存选择；首次 Base 下载文件较大，手机耗时和内存仍需验收。切换模型后刷新页面，只在未进入训练流程时允许切换。
- Whisper Base 不是 ChatGPT，仍是免费的浏览器本地模型。模型会从 Hugging Face / 镜像及 Transformers.js CDN 下载，首次需要联网；音频数据不会作为 ASR 请求上传第三方。
- 原 R6 及当前线上 R2.1 未更改；此包不是已公开部署的版本。

## 如何测试
1. 本地 HTTPS 或开发服务器托管 `site/`，打开 `/tcl-v352-asr-autoqa-r23/`；iOS Safari 需要 HTTPS 才能允许麦克风，文件 App 的 `file://` 方式不一定可用。
2. 右上角更多工具中切换 Tiny 或 Base，开始练播、回答一题、下一题、回看文字与录音；连续 3 题检查串题和人工答案保护。
3. 首次 Base 下载与内存开销高于 Tiny。若失败先切 Tiny，保留本题录音，错误信息请截图。
4. 运行 `node --test tests/*.mjs`； `node --input-type=module --check <site/tcl-v352-asr-autoqa-r23/app.js`；运行 Chromium E2E 需要 Playwright 和可访问本地服务器的 Chrome 环境。当前隔离环境阻止 localhost，E2E 标记为 NOT RUN。

## 已证实 / 未证实
- Node 共 16 项单元测试 PASS（含原版 9 项＋新增模型切换 7 项）；JS ESM 语法 PASS； 14 个静态文件完整，manifest 13/13 哈希匹配。
- Base 模型启用、管线参数以及两种模式路由由 mock 测试证明；另一次独立 GitHub Actions 真正运行了两种模型，单条公开普通话样本上 Tiny 字错率 23.08%、Base 0%，证据见 https://github.com/lijianjun004-star/tcl-v43-preview/actions/runs/43903675421 。**此单样本不能证明 TCL 产品型号准确率或 iPhone 手机稳定性**。
- 此候选不自动选择识别结果更好的一方、不改变专业型号写法、不自动评分；Whisper 文字及型号数字需要人工核对。
- 如后续部署必须以独立 `/tcl-v352-asr-autoqa-r23/` 路径上线，校验 `site.zip` SHA 为 `099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e` 不改变，并通过 PR/CI 后再进行。不得覆盖正式 R6。