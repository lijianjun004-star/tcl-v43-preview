# TCL 练播房 R2.2｜真正的 OpenAI 录音转文字 API 接入候选

日期：2026-11-16；任务状态：**完成独立候选代码与模拟测试；未配置账号、未启用收费、未部署**。

## 官方能力核验结论
- 普通 GitHub Pages 网页无法自行借用 ChatGPT Plus 订阅额度进行 API 自动转写。
- Sign in with ChatGPT 的订阅额度共享仅对开放接入的合作应用与适用请求有效；本 TCL 练播房没有取得该资格。
- 正确路线：录音结束得到本题音频 Blob → 仅在主播明确启用后上传至由自己管理的安全代理 → 代理持有 OpenAI API key → 使用 `gpt-transcribe` → 返回 `{turnId,text}` → 原有逐题保护机制写回对应题目。
- `gpt-transcribe` 的官方估算费用在本报告日期为约 US$0.0045/分钟；具体以实际平台账单为准。需单独的 API 权限与预算。不要把 ChatGPT 登录 cookie、订阅凭据、密钥写入网页。

## 本轮确实交付了什么
- `site/`：R2.2 独立网页预览，基于已发布 R2.1 app.js（修复 ESM 重复声明的版本）拷贝，带 OpenAI 设置对话框。**默认继续使用本地 Whisper，绝不自动产生 OpenAI 费用**。选择 OpenAI 需要用户手动输入独立代理地址及至少20位测试访问码，再勾选单独计费确认。
- `site/openai-asr-client.mjs`：前端可选服务端模式，凭内存中的测试访问码发送本题录音。若响应的 turnId 与本题不符则绝不写入。显式 `source=openai-api` 与本地模式区分。
- `worker/index.mjs`：Cloudflare Workers 风格的安全代理服务端示例，OpenAI API key 只位于服务器密钥环境；严格来源校验，访问令牌鉴权，音频上限8 MiB，日请求限制（KV 最终一致，仅*尽力而为*），无配置/未确认计费时 fail-closed。
- `worker/wrangler.toml.example`：不含真实密钥，不可将 API key 放在前端。
- `tests/`：17项前后端 Node 单测通过；中文真机准确率不在这份模拟测试范围内。

## 缺少的关键条件（禁止虚报成功）
- 仍未获取用户授权的 API 账单预算，**未创建 OpenAI API 密钥**、未开通费用。
- 仍未部署服务器代理；浏览器使用 OpenAI 模式时会提示“未配置”，不能声称已经实际连接 ChatGPT。
- 本地 Chromium 浏览器导航被运行环境策略禁止：`ERR_BLOCKED_BY_ADMINISTRATOR`，所以本轮 E2E **未执行**。过去 R2.1 在 GitHub CI 的真实 Chromium三题模拟通过，只说明原版流程可用。
- Cloudflare KV 为最终一致，简单日计数并非精确的支出硬上限；部署前还必须在 OpenAI API 平台设置项目级预算/限额与可靠的原子限流。

## 发布边界
- 原仓库：`lijianjun004-star/tcl-v43-preview`，本轮审查 main SHA `351486d0ea714ee3a57c240bdd053f7addee8c3a`。
- 原正式 R6 site.zip SHA-256 `099a57016c1ae24eab6b30cecfdc9ddaf3160571c6c500853f81bf5a654b924e`：绝不可覆盖。
- 原独立 R2.1：`/tcl-v352-asr-autoqa-r2/`：保持不变。
- 将来独立 R2.2 只能使用全新路径 `/tcl-v352-asr-openai-r22/`，且需要单独的发布门禁、先 CI、后明确批准。

## 正式上线必要条件
1. 用户明确同意 OpenAI API 单独计费，以及预计支出上限；设置后端机密变量和服务端硬性支出控制。
2. 独立后端审核、授权测试、跨域测试、限流滥用测试，开源代码中不包含秘钥。
3. 以独立 Pages 测试路径发布、不修改原 `site.zip`，新路径覆盖 3题录音、结束直播、人工修改、超时、授权失败。
4. iPhone Safari 实测3题真实中文、产品型号/价格/单位准确率，再决定是否升级正式站。

## 官方法规与文档
- OpenAI ChatGPT/API 独立账单：https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
- Sign in with ChatGPT：https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites
- 转写指引：https://developers.openai.com/api/docs/guides/speech-to-text
- API gpt-transcribe 模型：https://developers.openai.com/api/docs/models/gpt-transcribe