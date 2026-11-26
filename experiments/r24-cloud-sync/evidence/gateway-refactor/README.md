# R24 私有出题网关改造与验收

上海试点候选 **R24-20261124.10**。基线提交 `27001ef3992d5071c40a8142b9cd8ebec2516202`，实现提交 `f6234b4b0edc59e5426c69e12a7617e15cb9d55e`。2026-11-26 UTC。本次交付的是试点云函数侧网关客户端、运营页面和回归证据，未发布到腾讯云。[命令与原始输出](terminal.txt) · [函数配置、变量与实际触发步骤](../../cloudbase/README-CloudBase.md#私有网关联调)

## 业务结果

运营生成请求由试点服务向配置的 HTTPS 端点提交。凭证绑定在函数服务端。成功草稿的来源为 `openai_gateway`，`degraded=false`。应用校验的字段为非空 `questions`、每题的 `question`、`answer` 和非空字符串数组 `keyPoints`。草稿页支持逐题编辑，再由运营确认和发布。

当边界错误允许兜底、开关开启且原资料含有完整问答与要点时，返回 `source=fallback`、`degraded=true`、安全错误码和中文原因。可用规则支持规范问答 JSON、单张表中具有受支持表头且有完整问答和要点的制表符文本。纯叙述、歧义表头、混合板块或不完整资料会收到明确失败。在配额或身份校验失败时，兜底也不会绕过权限。生成接口不会写入作业或共享题库。

## 已执行的检查

| 规格 | 实际范围和证据 |
| --- | --- |
| 缺配置 | 缺少地址、凭证或空白值时生成错误码 GATEWAY_CONFIG_MISSING。检查零 HTTP 请求、零预留；分别验证可兜底和非 200 失败。 |
| 正常响应 | Mock 200 验证 URL、POST、鉴权头、非流式请求、JSON 格式约束、三项数字用量，以及真实业务处理器的草稿响应。测试根 URL、版本化基址和完整路径。 |
| 非法输出 | 验证非法或截断 JSON、无效包裹、拒答、嵌套字段错误、空数组、空要点、重复或过多题目均不能作为成功草稿。检查失败分支不写入作业。 |
| 无重试状态 | Mock 400、401、403、404 等均只发送一次；错误保留可用代码和请求编号，原始上游正文、请求头、资料、异常堆栈不会转发给运营。 |
| 可重试状态 | 429、502、503、504 及指定超时/重置检查了两次尝试的上限，含失败后成功、连续失败、第二次配额不足及响应体挂起。退避参数 1500ms 由注入的 sleep 捕获。单次超时覆盖读取响应体。 |
| 页面和数据 | 浏览器及草稿校验 16/16，其中 11 项 Chromium、5 项共享校验；另行执行本地双会话业务冒烟 9/9、页面异常 0。网关失败显示编号，兜底来源贯穿编辑、确认与发布。 |
| 服务端 | 后端、云函数适配器及共享草稿回归共 81/81。与上行的 5 项共享校验有重叠，不叠加计数。独立暂存包安装锁定依赖并冷启动，两条无凭证请求均返回 401。 |
| 安全扫描 | 实现提交的 173 个 Git 跟踪条目和 320 个归档条目，签名与日志启发式匹配 0，覆盖缺口 0。扫描器回归 1/1。另在最终静态候选及安装依赖的函数包扫描 39 / 6123 个普通文件，密钥格式、公共上游域名及旧凭证变量名匹配 0。 |
| 构建与版本 | 合成配置的本机候选共 39 个文件（含清单），清单中的 38/38 个资源逐字节匹配。清单 SHA-256 为 `1c636308fb24c0438c94d1bef1727243bba215e3d8a6c9f99de7b0bad179fc25`。替换真实环境配置后清单会变化。 |

## UNVERIFIED / NOT EXECUTED

**真实新加坡 SCF 网关端到端联调尚未执行。** 工作区和已授权上海试点函数均缺少网关地址和服务凭证。本次没有可核实的新加坡服务地址、网关契约实物或上游访问授权。未调用真实网关、未生成真实模型账单，未修改腾讯云配置、模型开关或线上文件。旧分支的 GitHub 模型调用不能证明这条链路可用。

只读回查时，上海公网清单仍为 `r24-paraformer-excel-cloud-sync-v2-20261124.8`，SHA-256 为 `01d7a6fcee35351bdc307943fdaed47a4145e31041a6a03f76a513fada8a1604`。现行函数超时 **45 秒**。部署前应在试点函数配置 `AI_GATEWAY_URL`、`AI_GATEWAY_TOKEN`、`AI_GATEWAY_MODEL`、`AI_GATEWAY_TIMEOUT_MS` 和 `AI_FALLBACK_ENABLED`，核对运营名单及日配额。样例云函数时限为 180 秒，浏览器为 190 秒；真实上海 HTTP 接入层和新加坡上游能否允许该时限尚未验证。[环境样例](../../cloudbase/.env.example) · [工作台触发、结果核对及故障演练](../../cloudbase/README-CloudBase.md#私有网关联调)

## 剩余风险与检查边界

- 部署者须核实实际用戶和业务地区的服务授权以及可向网关发送的材料范围。上游公开支持列表未包含中国大陆。新加坡托管位置本身不构成面向上海试点用户提供上游服务的授权。[上游支持地区说明](https://help.openai.com/en/articles/7947663-chatgpt-and-openai-api-supported-countries-and-territories)
- 网关 URL 必须指向受控服务；该客户端禁用重定向且没有默认公网端点。配置校验无法证明 DNS、证书归属、服务运行地点或运营方资质。真实 TLS、网关鉴权、可用模型、响应兼容性、网关日志及实际计费均待确认。
- 重试可能发生在上游已经开始推理之后。每次网络尝试预留一次试点调用次数，日志仅能记录网关实际返回的可核实数字。缺少 usage 或未获得响应时记为 null，不能据此核算整笔账单。
- 规则兜底只恢复运营原资料里已有的答案和要点。对于只有用户画像或弹幕而无参考答案的材料，网关故障后须补资料或重试。多个工作表或未知表头不会被猜测映射。
- 日志扫描仅检查可识别的直接日志调用与敏感数据传递模式，动态故障测试另行检查测试凭证、原始异常和资料未出现在测试响应/日志中。无法以静态匹配证明任意第三方库、平台代理或历史云日志绝对无泄漏。扫描不改写 Git 历史、其他分支或旧工作流运行记录。工作区未跟踪文件不在 Git 对象扫描范围。SDK 安装目录另行扫描，跳过 1 个符号链接。
- 浏览器验收使用本机 Chromium、合成资料及音频。实体 iPhone、安卓、微信、真实海外网络延迟和生产账号均未执行。验收中第一次浏览器测试使用了更新前的站点包与更新后的断言，出现 1 项超时；重建最终候选后一致版本的 16 项通过。原始记录中保留这次失败。
- 安装依赖时 npm 对锁定依赖的 postinstall 给出提示；没有另外放行该脚本。离线安装、服务冷启动和上述回归均有实际结果。

## 逐文件变更

本分支包含 30 个实现及说明变更文件，另附本报告和终端记录。旧分支与历史运行仍保留供查证。

| 变更 | 仓库相对路径 | 核心函数或用途 |
| --- | --- | --- |
| 删除 | `.github/workflows/r24-openai-auth.yml` | 删除旧鉴权工作流 verify，避免该候选从 CI 直接触达上游。 |
| 删除 | `.github/workflows/r24-openai-draft.yml` | 删除旧出题工作流 draft，防止候选推送触发原推理通道。 |
| 修改 | `AI_CONTEXT.md` | 新增候选状态、历史测试边界和可复验入口，清理历史说明中的旧凭证变量名。 |
| 修改 | `experiments/r24-cloud-sync/README.md` | 更新「从资料生成口播练习」操作和兜底范围。 |
| 修改 | `experiments/r24-cloud-sync/backend/API.md` | 更新 POST /assignments/draft 的成功、降级与失败响应。 |
| 新增 | `experiments/r24-cloud-sync/backend/ai-gateway-client.mjs` | 新增 createAiGatewayClient、endpointFor、attempt、readEnvelope、readQuestions、publicUsage。规范化地址，发送固定协议，限制输入输出，超时与可重试错误最多重试一次。 |
| 修改 | `experiments/r24-cloud-sync/backend/api.mjs` | assignmentDraft / createApi 在授权、输入校验和路由响应间传递请求追踪信息。 |
| 新增 | `experiments/r24-cloud-sync/backend/assignment-draft-service.mjs` | 新增 generateAssignmentDraft、gatewayQuestions、localQuestions、startDraftCall、finishDraftCall。业务校验、来源、兜底、安全错误和单行日志。 |
| 删除 | `experiments/r24-cloud-sync/backend/openai-assignment-draft.mjs` | 移除 createOpenAIDraftGenerator / completedDraftText 的旧直连实现。 |
| 修改 | `experiments/r24-cloud-sync/backend/tests/ai-draft.test.mjs` | fixture 与 handler 测试覆盖真的客户端配 Mock 传输、降级开关、无可用数据、严格校验、去重、脱敏日志及无作业写入。 |
| 新增 | `experiments/r24-cloud-sync/backend/tests/ai-gateway-client.test.mjs` | 新增 mockClient 等测试夹具，检查协议、鉴权、配置、错误分类、退避、挂起与限额。 |
| 删除 | `experiments/r24-cloud-sync/backend/tests/openai-provider.test.mjs` | 移除只针对旧直连实现的测试，现由网关协议与业务测试覆盖。 |
| 新增 | `experiments/r24-cloud-sync/cloudbase/.env.example` | 提供五项网关参数和试点启用、运营名单、日限额示例，凭证值留空。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/.gitignore` | 忽略该目录的实际环境文件，保留示例。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/README-CloudBase.md` | 更新上海试点配置、工作台触发步骤、全链路时限、用量与区域核实要求。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/ai-draft-provider.mjs` | createCloudBaseDraftGeneration 接入私有客户端，canGenerate 验证运营，reserveQuota 为每次真实 HTTP 尝试预留配额。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/cloudbaserc.example.json` | tcl-r24-sync 云函数运行时示例提高至 180 秒，替换模型配置项。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/function.mjs` | createFunction 将配置的网关客户端和数据库限额适配器注入业务 API。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/stage.mjs` | 构建的 portable 目录收录网关客户端和草稿服务，凭证与环境文件不进入包。 |
| 修改 | `experiments/r24-cloud-sync/cloudbase/test/ai-draft-provider.test.mjs` | 运行时替身检查开关、稳定账号、限额失败、一次重试的第二次预留和缺配置时不计数。 |
| 修改 | `experiments/r24-cloud-sync/overlay/app.js` | operatorHome / confirmAssignmentDraft 保存草稿真实来源，更新模块缓存版本。 |
| 修改 | `experiments/r24-cloud-sync/overlay/assignment-draft-panel.mjs` | bindAssignmentDraftPanel / draftDiagnostics 显示来源、请求编号、退避次数与错误；编辑、确认、跨板块限制和失败收尾。 |
| 修改 | `experiments/r24-cloud-sync/overlay/assignment-sync.mjs` | request / generateDraft 提取错误诊断，并采用 190 秒的生成请求时限。 |
| 修改 | `experiments/r24-cloud-sync/stage-site.py` | main 使用新短版本和资源缓存参数，生成独立 .10 站点及静态清单。 |
| 修改 | `experiments/r24-cloud-sync/tests/README.md` | 更新本地复验入口及真实网关的测试边界。 |
| 修改 | `experiments/r24-cloud-sync/tests/browser.test.mjs` | 更新 Chromium 工作台夹具，验证来源、失败、编辑后确认、发布快照与防错误标注。 |
| 删除 | `experiments/r24-cloud-sync/tests/openai-draft-smoke.mjs` | 移除旧 CI 合成出题入口，历史运行记录仍可按原提交查阅。 |
| 新增 | `experiments/r24-cloud-sync/tests/scan-gateway.py` | 新增 Scan.tree / Scan.member / Scan.marked，按 Git 对象树及支持的嵌套归档扫描，命中仅报类别和路径。 |
| 新增 | `experiments/r24-cloud-sync/tests/test_scan_gateway.py` | 新增 ScanGatewayTest，核对归档中命中、未覆盖项、指定版本和输出脱敏。 |
| 修改 | `experiments/r24-cloud-sync/tests/v2-smoke.mjs` | 复验登录、发布、提交、录音与换机时默认期待 .10。 |
| 新增 | `experiments/r24-cloud-sync/evidence/gateway-refactor/README.md` | 本次执行报告、逐文件清单及未验证事项。 |
| 新增 | `experiments/r24-cloud-sync/evidence/gateway-refactor/terminal.txt` | 本机验证命令和原始终端输出，包括一次旧候选回归失败和最终复验。 |
