# TCL R24 Excel 作业云同步试点

上海试点版本 `R24-20261124.12`，线上出题与评分使用腾讯混元 `hy3`。[公网双角色验收](evidence/shanghai/v2-12-hunyuan/README.md)

沿用 QA3 的 Excel 校验、作业快照和浏览器本机复盘，身份、领取、提交和逐题录音写入专用 CloudBase 资源。登录页和工作台均可展开「设备码使用说明」。[上海试点入口](https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com/tcl-r24-cloud-sync-pilot/) · [操作说明](https://docs.google.com/document/d/1jWoMetHhMePm1fArrmYkKEGETwXOCoMq/edit) · [`.5` 公网双账号验收](evidence/shanghai/v2-5-public/README.md)

## 登录与换设备

1. 首次使用时，选择「主播」或「直播运营」，填写姓名，点「进入工作台（首次自动开通）」。姓名按 NFKC 和首尾空白规则规范化，须为 2–30 个字符。
2. 同一个已绑定浏览器再次打开时自动进入。手动退出后，用原姓名可重新进入。微信内置浏览器和手机 Safari 分别保存绑定。
3. 换设备时，在原设备打开「设备码生成器」。生成器显示适用姓名、角色及剩余有效期，可以复制或下载。设备码由 `R24-` 和 24 个十六进制字符组成，共 28 个字符。30 分钟内仅可绑定一台新设备，生成新码会作废此前未用的旧码。
4. 新设备输入相同姓名，按提示粘贴设备码。同名登记沿用原角色，两台设备仍使用同一个试点账号。原设备无法打开时，联系管理员重置绑定。重置保留历史作业和提交。[管理员重置步骤](cloudbase/README-CloudBase.md#管理员重置绑定)

公开试点按首次登记的姓名绑定设备，角色由首次登记人选择。此流程用于试点，使用合成测试资料。接入正式业务数据前需接入可验证的员工身份与角色授权。

## 作业流程

1. 运营校验并预览已有问答 Excel，或确认 AI 出题草稿。发布后同一试点团队的主播可领取，云端冻结题目、答案、品类、平台和版本哈希。
2. 主播按运营姓名或作业标题搜索，领取后逐题回答。页面保留本机草稿、录音和作答过程。
3. 主播主动点「提交到云端」。云端先保存文字、转写和提交记录，再尝试上传符合大小与格式限制的逐题录音。每段最多 512 KiB。网络或录音上传失败时，已确认的文字记录仍可查看，本机有原录音时可重试。整场录像保存在原浏览器的 IndexedDB。
4. 运营打开作业进度或刷新云端作业，可读取领取状态、提交时间、每题文字、转写和可播放的逐题录音。主播换设备后可查看同一作业及已提交的记录。浏览器内尚未提交的草稿和整场录像随原设备保留。

已有试点身份、作业和提交 ID 由迁移保留。QA3 与其他页面的本机数据按各自存储规则使用。

### 从资料生成口播练习

在「发布作业」展开「AI 出题草稿」。选择贴入场景文字，或从 `.xlsx`、`.xls`、`.csv`、`.tsv` 读取表格。每批资料最多 20,000 字，建议按产品、场景或主题拆分。选择题数并整理指令，再把可分享的内容复制到自己的 ChatGPT 或 Gemini 生成。

复制 AI 返回的完整 JSON，粘贴后点「读取草稿」。每题都可编辑顾客弹幕、参考话术和评分要点。将未核实的产品参数、价款和安装费用与对应型号及订单条款核对后，点「确认用于本次作业」，最后点「发布作业」。主播看到的是修订后的顾客弹幕。只有确认后主动发布的题目快照写入 CloudBase，整理指令和读取回复在浏览器中执行。

`.10` 候选的「AI 一键出题」使用管理员配置的私有网关。仅已开放的运营可将选定资料提交给网关。网关失败时，完整的结构化问答资料可按本地规则读取为兜底草稿，界面会标记来源；纯叙述资料缺少可核对的答案或评分要点时，界面显示错误和请求编号。两类草稿均须运营审核确认后才能发布。[云函数启用配置与联调步骤](cloudbase/README-CloudBase.md#一键出题的启用配置)

### 主播发起 AI 评选（`.11` 候选）

领取已发布的云端作业，逐题填写回答或核对录音转写。练播结束后，在「逐题复盘详情」上方点「发起 AI 评选」，核对总分、每题评语、命中及遗漏要点和改进话术，再提交到云端。运营打开「作业进度」或「主播记录」可查看随该次提交保存的评选，最终由运营复核。历史记录会标出「未生成 AI 评选」。服务暂不可用时，可保留请求编号用于排查，也可直接提交已有回答。管理员需启用试点 AI 功能。[评选接口与数据边界](backend/API.md) · [云函数配置](cloudbase/README-CloudBase.md)

### 上海混元出题与评选（`.12`）

上海试点通过 CloudBase 的腾讯混元模型生成草稿和逐题评选。运营先核对草稿的产品参数、话术与评分要点再发布。主播可以在复盘页查看评分依据，提交后运营可回看这一场次的评选结果。模型名称以本次响应或已保存的记录为准。

北京时间 2026-11-27 10:04，使用开发端临时身份和官方服务端 SDK 在上海调用 `cloudbase/hy3`，真实生成并校验一份合成草稿（407 tokens）和一份逐题评选（717 tokens）。本次沿用已有环境模型配置。旧分组 `hunyuan-v3/hy3-preview` 在同一环境返回 HTTP 429 `EXCEED_TOKEN_QUOTA_LIMIT`。正式分组可用，管理清单显示的空模型数组不足以判断可用性。[脱敏实测记录](evidence/shanghai/v2-12-hunyuan/sdk-probe.json) · [腾讯云额度错误说明](https://docs.cloudbase.net/error-code/EXCEED_TOKEN_QUOTA_LIMIT)

## 构建与验证

准备 Python 3.11+、Node.js 22+ 和 Chromium。先用原 QA3 LITE 包的工具补齐四个模型，核验清单本身和列出的 35 个资源。使用新的输出目录生成候选。

```sh
python3 stage-site.py /path/to/verified/tcl-r24-paraformer-excel-qa candidate-cloud \
  --env-id YOUR_ISOLATED_ENV_ID --api-base https://YOUR_HTTP_GATEWAY/tcl-r24-sync
node --test backend/tests/*.test.mjs
(cd cloudbase && npm ci && npm test)
(cd tests && npm ci && TCL_TEST_SITE_DIR=/absolute/path/to/candidate-cloud npm test)
(cd tests && TCL_V2_LOCAL=1 TCL_TEST_SITE_DIR=/absolute/path/to/candidate-cloud node v2-smoke.mjs)
```

仅用于本机或静态演示时可以省略环境和 API 参数，候选保留原有手工 JSON 交接。本版云端候选含 41 个资源及 `static-manifest.json`。构建和本机测试均在独立候选目录执行。[CloudBase 适配与部署](cloudbase/README-CloudBase.md) · [API 接口](backend/API.md) · [浏览器复验](tests/README.md)
