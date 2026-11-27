# R24 作业云同步 CloudBase 适配

现有上海试点沿用 Event 函数和 PostgreSQL。身份、作业、领取及提交使用独立表，逐题录音使用 CloudBase PG Storage 的专用私有存储桶。

| 项目 | 上海试点值 |
| --- | --- |
| 环境和地域 | `unknown-roadrunner-d7cap6e21f517`，`ap-shanghai` |
| 静态托管路径 | `/tcl-r24-cloud-sync-pilot/` |
| 函数及 HTTP 网关路径 | `tcl-r24-sync`，`/tcl-r24-sync` |
| PostgreSQL 表名前缀 | `tcl_r24_sync_v1` |
| 私有录音桶 | `tcl-r24-sync-v2-audio` |
| 页面源 | `https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com` |

## 数据库与权限

升级已有试点时，由数据库所有者确认试点表、设备码 RPC、PG Storage 及其行级权限存在，再依次应用 [作业与私有录音迁移](schema-workflow-v2.sql) 和 [身份与绑定迁移](schema-identity-v2.sql)。两份 SQL 各自在事务内执行，各应用一次。先核对新表、函数、存储桶及策略名，遇到已占用的同名资源应先核对来源和结构。

如需在独立空白环境搭建，先执行 [基础表结构](schema-postgresql.sql)、[设备绑定](schema-device-grants.sql) 和 [自助签发](schema-device-self-service.sql)，再应用两份 V2 迁移。V2 使用 `tcl_r24_sync_v1` 前缀及 `r24-pilot` 团队。云函数运行环境以 CloudBase 注入的 `TCB_ENV`、`SCF_NAMESPACE` 或调用上下文 `namespace` 为准，存在多项时必须一致。

| 资源 | 用途 |
| --- | --- |
| `tcl_r24_sync_v1_enrollments` | 稳定账号 ID、姓名、角色、入组方式和时间、重置状态。 |
| `tcl_r24_sync_v1_device_grants` | 一次性设备码及设备凭证摘要、到期和撤销状态。 |
| `tcl_r24_sync_v1_device_attempts` | 按可信来源 IP 的摘要、操作和 5 分钟时间窗进行频率限制。无法获取网关可信 IP 时使用更严格的共享限额。 |
| `tcl_r24_sync_v1_assignments`、`tcl_r24_sync_v1_claims`、`tcl_r24_sync_v1_submissions` | 冻结作业、领取和文字提交。 |
| `tcl_r24_sync_v1_submission_audio` | 私有逐题录音的大小、哈希、格式和已确认状态。 |

云函数以服务端角色访问数据库和存储桶。匿名和浏览器角色不能直接调用开通 RPC、读写录音表或读取桶内对象。每段录音上限 512 KiB，提交人及作业发布人可通过鉴权 API 读取相应录音。存储策略仅限制试点桶。沿用已有账号 ID、设备凭证与作业引用。90 天是单台设备绑定的最长有效期，新签发的一次性设备码有效期为 30 分钟。

新员工首次开通使用自填姓名和自选角色，适合限定范围的测试资料。正式业务需要可验证的员工账号和服务端角色授权。新姓名开通无需启用环境级用户名密码设置。旧版 CloudBase 原生登录凭证的过渡验证逻辑仍可使用。试点与同域页面共享浏览器安全源，绑定浏览器应只运行可信的同源脚本。

## 管理员重置绑定

先核实人员身份和角色，由数据库所有者按规范化姓名查询账号。若查到同名多条记录，先核定唯一账号 ID。安排员工在管理员操作后立即用原姓名和原角色重新开通。

```sql
SELECT id, display_name, role
FROM public.tcl_r24_sync_v1_enrollments
WHERE team_id = 'r24-pilot' AND active
  AND name_key = public.tcl_r24_sync_v1_canonical_name('<已核实的姓名>');
```

确认后只针对该账号执行重置。

```sql
SELECT public.tcl_r24_sync_v1_reset_device_binding('<已核实的账号 ID>');
```

返回 `{"reset":true}` 时，原设备凭证和此前可用的设备码立即撤销。下一次以同姓名、原角色开通会恢复同一账号 ID，既有作业、领取和提交继续归属于该账号。重置成功后到员工重新绑定之间，知道姓名和原角色的人可能抢先开通，须和本人约好操作时间。该 SQL 由数据库所有者执行，浏览器和云函数服务角色无执行权限。

## 打包与部署

```sh
cd cloudbase
npm ci
npm test
mkdir -p /path/to/isolated-staging/functions
npm run stage -- /path/to/isolated-staging/functions/tcl-r24-sync
```

上海试点复用现有函数配置、网关绑定与 HTTPS 来源。环境变量参考示例文件和下方配置。[函数配置示例](cloudbaserc.example.json)

```json
{
  "TCL_R24_SYNC_ENABLED": "true",
  "TCL_R24_SYNC_ALLOW_SHARED_SHANGHAI": "true",
  "TCL_R24_SYNC_ENV_ID": "unknown-roadrunner-d7cap6e21f517",
  "TCL_R24_SYNC_COLLECTION_PREFIX": "tcl_r24_sync_v1",
  "TCL_R24_SYNC_ORIGINS": "https://unknown-roadrunner-d7cap6e21f517-1519058345.tcloudbaseapp.com"
}
```

使用 Node.js 20.19+ 运行时。HTTP 网关关闭路径透传并传递 `Authorization` 头，`OPTIONS` 预检可在没有设备凭证的情况下发出，函数只对配置的 HTTPS 来源返回 CORS 许可。

部署限本试点函数和路径。函数更新后验证未登录的 `GET /me` 返回 401，并验证新设备开通接口。托管仅上传候选更新文件和 `static-manifest.json`，禁止使用 `--prune`。发布前后核对试点之外的托管对象及 QA3 清单。账号密码、设备码、设备凭证和管理令牌禁止写入源码或发布证据。

## 一键出题的启用配置

试点云函数可按显式配置使用上海 CloudBase 原生混元或已有的 HTTPS Chat Completions 网关。原有设备凭证继续用于浏览器到试点云函数的鉴权。云函数到网关使用独立凭证。请由网关负责人核实服务条款、调用方和实际用户地区、资料处理范围。新加坡托管位置本身不能确认上海业务已获上游授权。[OpenAI 支持地区](https://help.openai.com/en/articles/7947663-chatgpt-and-openai-api-supported-countries-and-territories)

在 CloudBase 控制台选择上海环境 → 云函数 → `tcl-r24-sync` → 配置，将以下参数并入现有函数配置。密钥值仅通过云端安全配置录入。示例中的必填值留空，须替换为运营方提供的实际值。[环境变量样例](.env.example) · [函数配置样例](cloudbaserc.example.json)

| 变量 | 必填与默认 | 用途 |
| --- | --- | --- |
| `TCL_R24_SYNC_AI_MODEL_PROVIDER` | 缺省 `openai_gateway` | 上海原生混元正式组填 `cloudbase`。预览组填 `hunyuan-v3`。 |
| `TCL_R24_SYNC_AI_MODEL_ID` | 原生混元必填 | 配对使用 `cloudbase / hy3` 或 `hunyuan-v3 / hy3-preview`。仅在环境开通相应模型和额度后使用。 |
| `AI_GATEWAY_URL` | 网关模式必填 | 已获授权的 HTTPS 网关，可填根地址、以 `/v1` 结尾的地址或完整 `/v1/chat/completions`。 |
| `AI_GATEWAY_TOKEN` | 网关模式必填 | 网关分配给试点函数的服务凭证。 |
| `AI_GATEWAY_MODEL` | 默认 `gpt-4o-mini` | 由网关实际开放的模型标识。 |
| `AI_GATEWAY_TIMEOUT_MS` | 默认 `30000` 毫秒 | 单次请求时限，支持 1–30000 毫秒。超时包括读取响应。 |
| `AI_FALLBACK_ENABLED` | 默认 `true` | `true` 允许用完整结构化资料生成规则草稿；`false` 返回包含原因和请求编号的错误。 |
| `TCL_R24_SYNC_AI_ENABLED` | 默认关闭 | `true` 时检查可用运营名单。 |
| `TCL_R24_SYNC_AI_OPERATOR_IDS` | 启用时必填 | 经过核实的运营账号稳定 ID，多个以英文逗号分隔。 |
| `TCL_R24_SYNC_AI_DAILY_LIMIT` | 默认 `5` | 整个试点按上海日期计数，范围 1–20。 |

启用前确认试点专用日限额表和服务端 RPC 已就绪。[日限额 SQL](schema-ai-drafts.sql) 每次实际调用前预留一次额度，包括重试；连接超时可能发生在网关已开始生成之后，重试可能再次消耗 token。配置示例使用 90 秒云函数执行时限。共享客户端每次 HTTP 尝试最多 30 秒，最多重试一次，退避 1.5 秒。两次请求与配额预留、退避共用 61.5 秒上限；其余时间留给鉴权、存储和返回。管理员需同时核对网关和 HTTP 入口的时限。

### 上海原生混元联调

原生出题使用 `@cloudbase/node-sdk@4.2.1` 和云函数临时服务身份。开通指定模型后，请核实出题用的供应商 token 额度、运营名单和试点日限额 RPC。每次出题至多尝试一次，服务端等待上限为 30 秒。

用合成运营调用出题。成功响应显示 `source=cloudbase_hunyuan`、配置的模型 ID、`degraded=false` 和请求编号。上游报告的用量保存在响应中。供应商返回 `EXCEED_TOKEN_QUOTA_LIMIT` 时，业务接口显示 `HUNYUAN_TOKEN_QUOTA_EXCEEDED`。开启 `AI_FALLBACK_ENABLED` 时，完整结构化资料可生成规则草稿。[腾讯云模型额度错误说明](https://docs.cloudbase.net/error-code/EXCEED_TOKEN_QUOTA_LIMIT)

新作答先提交，由已开通的仓库队列处理评分。旧客户端请求同步评选时，可读回本人匹配的历史结果；需新评分时收到提交指引。上海出题模型和日额度仅用于出题。[评分接口](../backend/API.md#ai-辅助评选)

### 私有网关联调

1. 完成上游授权及配置后，在测试环境仅向指定的合成运营开放按钮。在运营工作台的「发布作业 → AI 出题草稿」选择电视、京东，输入「顾客担心电视包装过不了电梯转角，请说明入户前如何测量」，选 1 题并点击生成。
2. 在浏览器网络面板核对 `POST /assignments/draft` 的结果包含 `source=openai_gateway`、`degraded=false`、请求编号和一题完整草稿。用请求编号在试点函数的日志里核对 HTTP 状态、重试次数及网关实际返回的用量。操作只到草稿预览，不必发布作业。
3. 在隔离的测试配置中使用上游提供的故障模拟或本地替身，测试拒绝鉴权、超时和非法输出。结构化资料示例为 `{"questions":[{"question":"入户前测哪里？","answer":"先核对包装和通道尺寸。","keyPoints":["核对包装尺寸","测量通道"]}]}`。开启兜底时应显示本地规则来源、原错误原因和编号；关闭兜底或资料无法提取时，应收到非 200 错误并结束加载。检查生成接口没有写入任何题目或作业。
4. 验收记录只保留短版本、请求编号、状态、响应来源和数字用量。不要将令牌、整份请求头、作业资料或完整上游响应复制到工单中。停用试点生成时将试点功能开关设为 `false`。

## 验证

运行 [接口测试](../backend/API.md) 和 [浏览器复验](../tests/README.md)，检查发布、领取、提交、运营播放、换机、错角色提示和复用拒绝。测试合成账号只使用合成 Excel 和录音。云端列表每批至多读取 10 条，超过 100 批或约 8 MiB 会拒绝请求。扩大试点前需将筛选和分页下推到数据库。

[CloudBase HTTP 网关](https://docs.cloudbase.net/en/service/access-cloud-function) · [路径透传](https://docs.cloudbase.net/service/path-passthrough) · [PostgreSQL 数据角色](https://docs.cloudbase.net/en/database/postgresql/roles)
