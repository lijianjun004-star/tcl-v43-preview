# 继续执行清单（需要用户完成授权的阶段）

1. **不要直接在 GitHub Pages 上配置任何 OPENAI_API_KEY。**
2. 如用户选择按量计费，启用专用 OpenAI API project，并设置账户预算与调用限制。ChatGPT Plus 不自动抵扣这笔费用。
3. 使用 Cloudflare Worker（或其他具备独立鉴权、限流能力的后端），部署 `worker/index.mjs`。配置 `OPENAI_API_KEY`、`ASR_ACCESS_TOKEN` 为 Worker secrets；`ALLOWED_ORIGIN=https://lijianjun004-star.github.io`。默认 `ASR_BILLING_ENABLED=false`，在验收前不要改为 true。
4. 绑定 KV 命名空间 `ASR_USAGE_KV`，并增加强一致的费用/并发限制或等效后端账单预算保护。**不能只依靠本例 KV 的日计数保障硬预算。**
5. 使用无敏感信息的 WAV/WEBM 测试跨域请求。后端只允许 `POST /transcribe`；任何路由路径都不应该转发到 OpenAI。
6. 经用户确认后仅发布 `/tcl-v352-asr-openai-r22/`；默认本地识别，主播手工切换 OpenAI 后需要输入自有服务端地址和访问码，音频才会离开设备。
7. 实测结束录制、单题 Blob 提交、重复录制、用户人工修改、超时和题目 ID 校验，不通过则立即停用 OpenAI 转写模式。**禁止未经同意自动切换收费服务。**
8. 前端不得存储 API 密钥或访问码到 localStorage、URL、页面源码或提交历史。