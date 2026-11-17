# 姓名、密码、邀请码开户：后端验证

2026-11-17 UTC。冻结后端已实际部署；公网 broker、官方原生 Auth 与云 PostgreSQL 业务验收 **72/72 通过**。本地 SQL/handler 测试也通过，但其中原生账户服务是模拟实现。原始 broker 总状态仍为 `PASS_WITH_NOT_RUN`，其 4 项 NOTRUN 原样保留；后续独立 provider 审计作为补充证据，不改写原记录。

本文只汇总后端证据。实际产品 UI 验收、最终正式数据保全审计和完整发布结论分别交付。

## 冻结代码与实际部署

| 文件 | SHA256 |
| --- | --- |
| `001-name-identity.sql` | `0cea86c37538ee6212dad529434b207a8768f24139b8773ecac063c737f1ad4c` |
| `handler.cjs` | `b5bee8e6fbf7cf4c06ccd85f29312160e11d751161d07219d8c3d6432b83d39a` |
| `provider-cloudbase.cjs` | `5dd3a1054245b0e75d282f0a0d3fe44b3523af4af6cb7bf876f9a08f0187c78c` |
| `API_CONTRACT.md` | `329fc8f565a8d6276122fcb1b0cb14a882207217fafa9a4ca4a21b245f38e60d` |

Root 提供的最终部署记录显示：`r25wf_name_identity` 为 EVENT 云函数，Node.js 20.19、60 秒、128 MiB；2026-11-17 07:47:42 UTC 部署成功。生产工作目录虽沿用 `r25-name-provider-probe` 名称，现已放正式实现，其 handler/provider/index 与仓库文件逐字节哈希相同；安装的官方 `@cloudbase/manager-node` 为 5.10.4。函数通过 `/r25-name-identity` 独占 HTTP 服务路径访问。公开 resolve 探针为 HTTP 200、ready，未保存账户名或 UID。

SQL 最终部署 request ID 为 `15961ac9-485d-4063-8347-48f91497c1a8`。代码部署与 SQL 部署证据见 [backend-deployment-summary.json](backend-deployment-summary.json)。这些是 Root 提供的部署记录和本地生产目录比较，不额外宣称已下载远端部署包做哈希认证。运行时临时 STS 身份此前由只读 Event 探针验证；正式实现没有永久密钥回退。

## 实际云端验收：72 项

执行区间：08:06:33–08:07:59 UTC。使用实际部署的 HTTPS broker、官方 CloudBase JS SDK 3.11.1、原生 Auth、云 PostgreSQL RPC；没有模拟成功响应。Chromium 156.0.8078.79，独立登录 context，结束后全部关闭，进程退出码 0。

- 用中文姓名、自设密码和有效邀请实际创建运营、主播及无权访问他人记录的测试账号；官方 Auth 接受 29 字符的内部原生用户名，登录返回的 UID 与服务器业务身份一致。
- 在独立 context 中重新按姓名解析并用原密码登录，仍取得相同原生 UID/角色；同 operation/secret 的 status 和成功响应回放保持 UID；错误 secret、status 携带密码、重复姓名及客户端指定角色/UID/内部用户名均被拒绝。
- 无邀请码、错误邀请码及弱密码请求被拒绝；弱密码没有创建 alias/reservation，原有效邀请随后仍可使用。这些断言本身不证明原生 CreateUser 内部调用次数。
- 实际创建任务、加入任务、提交并取得 receipt；所属运营 inbox 收到记录并写反馈，主播读回已持久化反馈；其他测试账号读提交和反馈被拒绝。各 context 在其他账号登录后仍保持自己的 UID。
- 原有管理员在测试前后均可用原密码登录，UID 保持不变；旧原生用户名及其大小写规范化命名空间未被新姓名抢占。这只证明所测账号，不能替代正式业务全表保全审计。

逐项名称、pass 布尔值和原样 NOTRUN 已收录于 [backend-verification-results.json](backend-verification-results.json)。它是去除原始 detail、UID、姓名、operation ID 和请求内容的白名单投影。原始 `broker-1/result.json`、执行命令、build 记录及扫描结果的哈希保存在 [backend-verification-source-manifest.json](backend-verification-source-manifest.json)。

## 原始 4 项 NOTRUN 与独立补充

| broker 原始 NOTRUN | 本次汇总可支持的结论 |
| --- | --- |
| 无效邀请不创建任何原生账号的 provider 前后审计 | 后续实际审计已补充：一次无效邀请请求返回 `400 INVALID_INVITE`；将该请求及下述弱密码请求合并夹在完整官方账号列表读取之间，前后均 10 个，UID 哈希集合完全相同。只覆盖本次两次拒绝请求的前后账号状态。 |
| 弱密码路径原生 CreateUser 调用次数为零 | 后续一次弱密码加有效未用邀请的请求返回 `400 INVALID_PASSWORD`，同一前后完整列表不变，证明该请求未新增原生账号。没有服务器内部 CreateUser 调用跟踪，不能声称调用次数已证为零。 |
| 正式业务数据排除合成写入后的完整可信 SQL 快照比较 | 本文未完成。Root 另交最终原数据保全审计；72 项中的旧管理员登录和 UID 检查不能替代它。 |
| 原生 CreateUser 成功后、SQL finalize 前的受控中断 | 实际云端未运行。成功响应重放/status 已测；本地模拟 provider 的丢响应与 finalize 失败恢复已测，均不能替代该真实故障窗口。 |

补充 provider 审计完成于 08:21:28 UTC，结果 [backend-native-negative-audit.json](backend-native-negative-audit.json) 只包含 HTTP 状态、错误码、计数及 UID 哈希，无账号或凭据。原始 broker 的 4 项 NOTRUN 没有被删除或改为 PASS。未根据账户名称推断来源或删除未知系统管理员。

## 本地验证：真实 SQL，模拟 Auth/Native

以下最终结果的 SQL/handler 源码哈希均与冻结文件相符，`cloudCalls=0`。PGlite 0.5.16 实际执行 PostgreSQL 18.6 SQL；Auth claims 及 Native create/lookup 由本地测试夹具提供。它们不属于云原生开户验收。

| 本地组 | 通过断言数 | 范围 |
| --- | ---: | --- |
| service | 102 | 服务角色/浏览器 ACL、邀请状态、持久预约/证明回放、原生 marker/旧 UID 拒绝、事务绑定、NFKC、关闭后重新打开数据库。含 50 次成功后的限流边界，不是 102 个独立场景。 |
| handler | 48 | 实际 handler+SQL 配合模拟 Native；CreateUser 丢响应、finalize 失败后恢复、并发重试、原生 marker/旧 UID 拒绝、密码规则前置、原秘密不进入 SQL。 |
| namespace | 17 | 旧原生用户名规范化命名空间、预约/alias/profile/native 共享约束、无关 UID 不可覆盖。 |
| historical alias precedence | 7 | 升级前同名夹具，旧 ASCII 原生用户名优先精确解析，保持原 UID。 |
| 两连接原生 PostgreSQL 并发 | 19 | 本机原生 PostgreSQL 18.6，两独立 backend PID；真实持锁/等待，验证新 reserve 与旧 redeem 的同/不同邀请、正反次序，测试次序无死锁且失败者不消耗邀请。 |

最后一组是本机 PostgreSQL 实例，不是 PGlite 的模拟并发，也不是云端 PostgreSQL 并发。其 Auth 仍为模拟，只证明已执行的事务交错，不覆盖所有可能调度。

最小可重放材料见 [local-replay/README.md](local-replay/README.md)：逐字节保留原测试脚本、历史 SQL 夹具、5 组最终合成本地结果及 [来源哈希](local-replay/SOURCE-SHA256.json)。薄 runner 只在临时副本调整绝对文件路径，结果不覆盖原快照，不包含 PG 数据目录或 node_modules。脚本中的固定口令/邀请码仅为公开的本地合成夹具，不能用于真实账号。

该提交 runner 已于 08:28:57–08:29:06 UTC 本地执行一轮，5 组均退出 0，再现 102/48/17/7/19 个通过断言，cloudCalls 均为 0；见 [replay-summary.json](local-replay/replay-summary.json) 及 [提交材料哈希](local-replay/REPLAY-SHA256.json)。它是重放脚本的验证，没有增加云端覆盖或抹去历史结果。

早期与修复前结果仍保留在原测试目录，没有覆盖成最终成功。`legacy-redeem-shadow-result.json` 的 `BLOCKED` 和最终 `legacy-casefold-result.json` 的 `BLOCKED_WITH_LEGACY_RESOLUTION_PRESERVED` 描述预期阻止抢占，不能当作未解决的执行失败；其前置复现、源码哈希及历史记录均在来源清单中。原 `INDEPENDENT-NATIVE-REVIEW.md` 是云验收前的静态检查点；其中 29 字符开户/登录的待验事项现由上述真实 72 项补齐。

## 最终权限与隐私检查

本次汇总期间，通过现有受信 CLI 实际执行一次只读 catalog/ACL SELECT，request ID `d02b0430-0c15-4287-93ae-5fd4ca446f33`，affected rows 为 0。结果 [backend-acl-result.json](backend-acl-result.json)，可复核语句 [backend-acl-readonly.sql](backend-acl-readonly.sql)：

- 5 张新 identity/name 表均启用 RLS，`anon` 与 `authenticated` 的 SELECT/INSERT/UPDATE/DELETE 任一权限均为 false，policy 数均为 0。
- 5 个相关函数对 `anon`、`authenticated` 的 EXECUTE 均为 false；`service_role` 可执行。主 service 为 SECURITY DEFINER，固定 `search_path=pg_catalog, public`。没有向浏览器授予管理 RPC。
- 最终 handler/provider/index 静态未发现 console 或文件持久化日志出口。密码只在内存中传给官方原生 create；PG 只接收 operation secret 的 SHA256 证明及规范化邀请码的 MD5 摘要，表结构不含密码、原 secret、原邀请码或 JWT。provider 递归拒绝秘密字段进入 SQL，错误只保留合法 code/request ID，不传播原始 SDK/SQL 异常。

原 broker 证据扫描报告声明：检查所提供测试密码/邀请码及 JWT 模式，无发现。本汇总对云端材料只复制明确脱敏的负例审计，其他云端结果使用白名单投影；本地重放快照全部来自合成夹具。没有读取或复制 private 配置、浏览器状态、PG 数据目录或真实密码/邀请码/operation secret。有限静态模式扫描另见 [backend-summary-secret-scan.json](backend-summary-secret-scan.json)，它不声称与未读取的私密值逐一比较。本文的应用代码检查不能证明云网关、平台日志或全部基础设施从未记录请求；这些平台日志设置本轮未审。

当前证据未发现新增后端阻断。真实受控崩溃恢复、CreateUser 内部零调用跟踪、最终正式数据审计及产品 UI 结果仍按上述边界单独报告。
